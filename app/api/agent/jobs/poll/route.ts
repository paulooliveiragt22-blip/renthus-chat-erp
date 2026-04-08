import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPrintAgentApiKey } from "@/lib/agent/verifyPrintAgentApiKey";

export const runtime = "nodejs";

/** Lista print_jobs pending para o agente (substitui polling direto ao Supabase). */
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const rawKey: string = body?.api_key ?? "";
        const v = await verifyPrintAgentApiKey(rawKey);
        if (!v.ok) {
            return NextResponse.json({ error: v.error }, { status: v.status });
        }

        const admin = createAdminClient();
        const { data, error } = await admin
            .from("print_jobs")
            .select("*")
            .eq("company_id", v.agent.company_id)
            .eq("status", "pending")
            .is("agent_id", null)
            .order("priority", { ascending: false })
            .order("created_at", { ascending: true })
            .limit(5);

        if (error) {
            console.error("[agent/jobs/poll]", error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, jobs: data ?? [] });
    } catch (e: any) {
        console.error("[agent/jobs/poll]", e);
        return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }
}
