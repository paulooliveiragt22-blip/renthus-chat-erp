// app/api/agent/auth/route.ts
// Chamado pelo Electron Print Agent para autenticar com a API key gerada no painel.
// Fluxo: rpa_{prefix8}_{hex} → lookup por prefix → bcrypt.compare → retorna credenciais

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import bcrypt from "bcryptjs";

export const runtime = "nodejs";

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const rawKey: string = body?.api_key ?? "";

    if (!rawKey) {
      return NextResponse.json({ error: "api_key obrigatório" }, { status: 400 });
    }

    // Extrai o prefixo: "rpa_4c630aba_..." → "4c630aba"
    const stripped = rawKey.startsWith("rpa_") ? rawKey.slice(4) : rawKey;
    const prefix   = stripped.slice(0, 8);

    if (prefix.length < 8) {
      return NextResponse.json({ error: "api_key inválida" }, { status: 401 });
    }

    const admin = createAdminClient();

    // Busca candidatos pelo prefix (pode haver mais de um em caso de colisão improvável)
    const { data: agents, error: fetchErr } = await admin
      .from("print_agents")
      .select("id, company_id, name, api_key_hash, is_active")
      .eq("api_key_prefix", prefix)
      .eq("is_active", true)
      .limit(5);

    if (fetchErr) {
      console.error("[agent/auth] DB error:", fetchErr.message);
      return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }

    if (!agents || agents.length === 0) {
      return NextResponse.json({ error: "api_key inválida ou agent desativado" }, { status: 401 });
    }

    // bcrypt.compare contra cada candidato
    let matchedAgent: typeof agents[0] | null = null;
    for (const agent of agents) {
      const ok = await bcrypt.compare(stripped, agent.api_key_hash);
      if (ok) {
        matchedAgent = agent;
        break;
      }
    }

    if (!matchedAgent) {
      return NextResponse.json({ error: "api_key inválida" }, { status: 401 });
    }

    // Atualiza last_seen
    await admin
      .from("print_agents")
      .update({ last_seen: new Date().toISOString() })
      .eq("id", matchedAgent.id);

    // Busca nome da empresa
    const { data: company } = await admin
      .from("companies")
      .select("name")
      .eq("id", matchedAgent.company_id)
      .maybeSingle();

    return NextResponse.json({
      ok: true,
      agent_id:         matchedAgent.id,
      agent_name:       matchedAgent.name,
      company_id:       matchedAgent.company_id,
      company_name:     (company as any)?.name ?? "",
      supabase_url:     SUPABASE_URL,
      supabase_anon_key: SUPABASE_ANON,
    });

  } catch (err: any) {
    console.error("[agent/auth] error:", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
