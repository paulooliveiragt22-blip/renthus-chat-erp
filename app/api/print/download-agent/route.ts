// app/api/print/download-agent/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PassThrough } from "stream";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import stream from "stream";

// IMPORTAR seu helper que valida company / acesso
// Ajuste o caminho se o arquivo estiver em outro lugar
import { requireCompanyAccess } from "lib/workspace/requireCompanyAccess";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const INSTALLER_FILENAME = "RenthusPrintAgentInstaller-v1.0.0.exe"; // ajuste se necessário
const INSTALLER_PATH = path.join(process.cwd(), "private_downloads", INSTALLER_FILENAME);

// API_BASE que o agente deverá usar (padrão: domínio do app + /api/print)
const API_BASE = (process.env.NEXT_PUBLIC_BASE_URL || "").replace(/\/+$/, "") + "/api/print";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

export async function GET(req: Request) {
    try {
        // 1) valida se o usuário tem acesso à company (seu helper deve checar cookies/sessão)
        const access = await requireCompanyAccess(req);
        if (!access || !access.companyId) {
            return new NextResponse("Unauthorized", { status: 401 });
        }
        const companyId = access.companyId;
        const companyName = access.companyName || `company-${companyId}`;

        // 2) gera AGENT_KEY e hash (bcrypt)
        const agentKey = crypto.randomBytes(32).toString("hex");
        const apiKeyHash = bcrypt.hashSync(agentKey, 10);
        const prefix = agentKey.slice(0, 8);

        // 3) grava no banco (print_agents)
        const { error: insertErr } = await supabase
            .from("print_agents")
            .insert([{
                company_id: companyId,
                name: `Agent - ${companyName}`,
                api_key_hash: apiKeyHash,
                api_key_prefix: prefix,
                is_active: true,
            }]);

        if (insertErr) {
            console.error("Failed to insert print_agent:", insertErr);
            return new NextResponse("Failed to create agent", { status: 500 });
        }

        // 4) garante instalador disponível
        if (!fs.existsSync(INSTALLER_PATH)) {
            console.error("Installer not found at", INSTALLER_PATH);
            return new NextResponse("Installer not available", { status: 500 });
        }

        // 5) cria o zip na memória com instalador + agent.env
        const passthrough = new PassThrough();
        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.pipe(passthrough);

        // adiciona o instalador .exe
        archive.file(INSTALLER_PATH, { name: INSTALLER_FILENAME });

        // cria agent.env com valores (já preenchidos)
        const agentEnv = [
            `AGENT_KEY=${agentKey}`,
            `API_BASE=${API_BASE}`,
            `AGENT_PORT=4001`,
            `DEFAULT_PRINTER_CONFIG_PATH=printers.json`
        ].join("\n");

        archive.append(agentEnv, { name: "agent.env" });

        // adiciona um README pequeno (opcional)
        const readme = `Renthus Print Agent\n\nExtraia este ZIP e execute o instalador.\nO arquivo 'agent.env' já vem preenchido para sua empresa.\n`;
        archive.append(readme, { name: "README_FROM_ERP.txt" });

        await archive.finalize();

        // 6) converte stream Node -> Web ReadableStream e retorna resposta
        const webStream = stream.Readable.toWeb(passthrough);
        const filename = `renthus-print-agent-${companyId}.zip`;

        return new Response(webStream, {
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
