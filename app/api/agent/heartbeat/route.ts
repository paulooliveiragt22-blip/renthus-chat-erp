// app/api/agent/heartbeat/route.ts
// Exige api_key + agent_id coerentes (evita spoof só com UUID).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPrintAgentApiKey } from "@/lib/agent/verifyPrintAgentApiKey";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const rawKey: string = body?.api_key ?? "";
        const agentId: string = body?.agent_id ?? "";

        if (!rawKey.trim()) {
            return NextResponse.json({ error: "api_key obrigatório" }, { status: 400 });
        }
        if (!agentId) {
            return NextResponse.json({ error: "agent_id obrigatório" }, { status: 400 });
        }

        const v = await verifyPrintAgentApiKey(rawKey);
        if (!v.ok) {
            return NextResponse.json({ error: v.error }, { status: v.status });
        }

        if (agentId !== v.agent.id) {
            return NextResponse.json({ error: "agent_id não corresponde à api_key" }, { status: 403 });
        }

        const admin = createAdminClient();
        const { error } = await admin
            .from("print_agents")
            .update({ last_seen: new Date().toISOString() })
            .eq("id", v.agent.id)
            .eq("is_active", true);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (err: unknown) {
        console.error("[agent/heartbeat]", err);
        return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }
}
