// app/api/agent/keys/route.ts
// GET  → lista agentes da empresa (sem hash)
// POST → gera nova API key para a empresa, retorna a key plaintext UMA VEZ

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import bcrypt from "bcryptjs";
import crypto from "crypto";

export const runtime = "nodejs";

// GET — lista agentes
export async function GET() {
  const access = await requireCompanyAccess();
  if (!access.ok) return new NextResponse(access.error, { status: access.status });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("print_agents")
    .select("id, name, api_key_prefix, is_active, last_seen, created_at")
    .eq("company_id", access.companyId)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agents: data ?? [] });
}

// POST — gera nova API key
export async function POST(req: Request) {
  const access = await requireCompanyAccess();
  if (!access.ok) return new NextResponse(access.error, { status: access.status });

  const body = await req.json().catch(() => ({}));
  const now = new Date();
  const defaultName = `Agente - ${now.toLocaleDateString("pt-BR")} ${now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const agentName: string = body?.name?.trim() || defaultName;

  const admin = createAdminClient();

  // Desativa agentes anteriores desta empresa (apenas 1 ativo por vez)
  await admin
    .from("print_agents")
    .update({ is_active: false })
    .eq("company_id", access.companyId)
    .eq("is_active", true);

  // Gera a key: 40 bytes hex = 80 chars
  const rawKey = crypto.randomBytes(40).toString("hex"); // 80 chars
  const prefix = rawKey.slice(0, 8);
  const hash   = await bcrypt.hash(rawKey, 10);

  const { data: agent, error: insertErr } = await admin
    .from("print_agents")
    .insert([{
      company_id:      access.companyId,
      name:            agentName,
      api_key_hash:    hash,
      api_key_prefix:  prefix,
      is_active:       true,
    }])
    .select("id, name, api_key_prefix, created_at")
    .single();

  if (insertErr || !agent) {
    return NextResponse.json({ error: insertErr?.message ?? "Erro ao criar agente" }, { status: 500 });
  }

  // Retorna a key completa UMA ÚNICA VEZ (formato: rpa_{rawKey})
  return NextResponse.json({
    ok: true,
    agent_id:   agent.id,
    agent_name: agent.name,
    // Chave completa — mostrar ao usuário e NÃO armazenar no frontend
    api_key: `rpa_${rawKey}`,
    // Só o prefix fica salvo no banco para exibição futura
    api_key_prefix: prefix,
  });
}

// DELETE — desativa agente
export async function DELETE(req: Request) {
  const access = await requireCompanyAccess();
  if (!access.ok) return new NextResponse(access.error, { status: access.status });

  const { agent_id } = await req.json().catch(() => ({}));
  if (!agent_id) return NextResponse.json({ error: "agent_id obrigatório" }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("print_agents")
    .update({ is_active: false })
    .eq("id", agent_id)
    .eq("company_id", access.companyId); // garante que pertence à empresa

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
