import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPrintAgentApiKey } from "@/lib/agent/verifyPrintAgentApiKey";

export const runtime = "nodejs";

/** Reserva job (pending → processing) se ainda livre e da empresa do agente. */
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const rawKey: string = body?.api_key ?? "";
        const jobId: string = body?.job_id ?? "";
        if (!jobId) {
            return NextResponse.json({ error: "job_id obrigatório" }, { status: 400 });
        }

        const v = await verifyPrintAgentApiKey(rawKey);
        if (!v.ok) {
            return NextResponse.json({ error: v.error }, { status: v.status });
        }

        const admin = createAdminClient();
        const { data, error } = await admin
            .from("print_jobs")
            .update({
                status: "processing",
                agent_id: v.agent.id,
                reserved_at: new Date().toISOString(),
            })
            .eq("id", jobId)
            .eq("company_id", v.agent.company_id)
            .eq("status", "pending")
            .select()
            .maybeSingle();

        if (error) {
            console.error("[agent/jobs/reserve]", error.message);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, job: data });
    } catch (e: any) {
        console.error("[agent/jobs/reserve]", e);
        return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }
}
