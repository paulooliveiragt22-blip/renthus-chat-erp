// app/api/agent/heartbeat/route.ts
// Chamado periodicamente pelo Print Agent para manter last_seen atualizado.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const { agent_id } = await req.json().catch(() => ({}));
        if (!agent_id) return NextResponse.json({ error: "agent_id obrigatório" }, { status: 400 });

        const admin = createAdminClient();
        const { error } = await admin
            .from("print_agents")
            .update({ last_seen: new Date().toISOString() })
            .eq("id", agent_id)
            .eq("is_active", true);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });

        return NextResponse.json({ ok: true });
    } catch (err: any) {
        return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }
}
