export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PassThrough } from "stream";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import stream from "stream";

import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INSTALLER_FILENAME = "RenthusPrintAgentInstaller-v1.0.0.exe";
const INSTALLER_PATH = path.join(
  process.cwd(),
  "app",
  "api",
  "print",
  "download-agent",
  INSTALLER_FILENAME
);

const API_BASE =
  (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/+$/, "") + "/api/print";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

export async function GET(req: Request) {
  try {
    // 1) Autentica e verifica acesso à empresa
    const access = await requireCompanyAccess();
    if (!access.ok) {
      return new NextResponse(access.error, { status: access.status });
    }
    const { companyId } = access;

    // 2) Garante que o instalador existe antes de qualquer operação no banco
    if (!fs.existsSync(INSTALLER_PATH)) {
      console.error("Installer not found at", INSTALLER_PATH);
      return new NextResponse("Installer not available", { status: 500 });
    }

    // 3) Busca nome da empresa
    const { data: company } = await supabase
      .from("companies")
      .select("name")
      .eq("id", companyId)
      .maybeSingle();
    const companyName = (company as any)?.name || `company-${companyId}`;

    // 4) Desativa agentes anteriores desta empresa (evita proliferação)
    await supabase
      .from("print_agents")
      .update({ is_active: false })
      .eq("company_id", companyId)
      .eq("is_active", true);

    // 5) Gera AGENT_KEY e hash (async — não bloqueia o event loop)
    const agentKey = crypto.randomBytes(32).toString("hex");
    const apiKeyHash = await bcrypt.hash(agentKey, 10);
    const prefix = agentKey.slice(0, 8);

    // 6) Registra novo agente no banco
    const { data: newAgent, error: insertErr } = await supabase
      .from("print_agents")
      .insert([
        {
          company_id: companyId,
          name: `Agent - ${companyName}`,
          api_key_hash: apiKeyHash,
          api_key_prefix: prefix,
          is_active: true,
        },
      ])
      .select("id")
      .single();

    if (insertErr || !newAgent) {
      console.error("Failed to insert print_agent:", insertErr);
      return new NextResponse("Failed to create agent", { status: 500 });
    }

    // 7) Monta ZIP em memória com instalador + agent.env
    const passthrough = new PassThrough();
    const archive = archiver("zip", { zlib: { level: 1 } }); // nível 1: .exe já é comprimido

    archive.on("error", (err) => {
      console.error("Archiver error:", err);
      passthrough.destroy(err);
    });

    archive.pipe(passthrough);
    archive.file(INSTALLER_PATH, { name: INSTALLER_FILENAME });

    const agentEnv = [
      `AGENT_KEY=${agentKey}`,
      `API_BASE=${API_BASE}`,
      `AGENT_PORT=4001`,
      `DEFAULT_PRINTER_CONFIG_PATH=printers.json`,
    ].join("\n");

    archive.append(agentEnv, { name: "agent.env" });
    archive.append(
      `Renthus Print Agent\n\nExtraia este ZIP e execute o instalador.\nO arquivo 'agent.env' já vem preenchido para sua empresa.\n`,
      { name: "README.txt" }
    );

    await archive.finalize();

    const webStream: any = stream.Readable.toWeb(passthrough);
    const filename = `renthus-print-agent-${companyId}.zip`;

    return new Response(webStream as any, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("download-agent error:", err);
    return new NextResponse("Server error", { status: 500 });
  }
}
