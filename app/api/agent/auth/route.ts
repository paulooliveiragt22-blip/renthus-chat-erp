// app/api/agent/auth/route.ts
// Chamado pelo Electron Print Agent para autenticar com a API key gerada no painel.
// Fluxo: rpa_{prefix8}_{hex} → lookup por prefix → bcrypt.compare

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPrintAgentApiKey } from "@/lib/agent/verifyPrintAgentApiKey";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => null);
        const rawKey: string = body?.api_key ?? "";

        const v = await verifyPrintAgentApiKey(rawKey);
        if (!v.ok) {
            return NextResponse.json({ error: v.error }, { status: v.status });
        }

        const admin = createAdminClient();

        await admin
            .from("print_agents")
            .update({ last_seen: new Date().toISOString() })
            .eq("id", v.agent.id);

        const { data: company } = await admin
            .from("companies")
            .select("name")
            .eq("id", v.agent.company_id)
            .maybeSingle();

        return NextResponse.json({
            ok: true,
            agent_id: v.agent.id,
            agent_name: v.agent.name,
            company_id: v.agent.company_id,
            company_name: (company as { name?: string } | null)?.name ?? "",
        });
    } catch (err: unknown) {
        console.error("[agent/auth] error:", err);
        return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }
}
