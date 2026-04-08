import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPrintAgentApiKey } from "@/lib/agent/verifyPrintAgentApiKey";

export const runtime = "nodejs";

/** Atualiza job com erro; `terminal: true` força failed sem nova tentativa. */
export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const rawKey: string = body?.api_key ?? "";
        const jobId: string = body?.job_id ?? "";
        const errorMsg: string = String(body?.error ?? "Erro desconhecido").slice(0, 2000);
        const terminal = body?.terminal === true;

        if (!jobId) {
            return NextResponse.json({ error: "job_id obrigatório" }, { status: 400 });
        }

        const v = await verifyPrintAgentApiKey(rawKey);
        if (!v.ok) {
            return NextResponse.json({ error: v.error }, { status: v.status });
        }

        const admin = createAdminClient();
        const { data: jobRow, error: jobFetchErr } = await admin
            .from("print_jobs")
            .select("id, company_id, attempts, max_attempts")
            .eq("id", jobId)
            .maybeSingle();

        if (jobFetchErr || !jobRow || jobRow.company_id !== v.agent.company_id) {
            return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
        }

        const currentAttempts = Number(jobRow.attempts ?? 0);
        const maxAttempts = Number(jobRow.max_attempts ?? 5);
        const willRetry = !terminal && currentAttempts + 1 < maxAttempts;

        const patch: Record<string, unknown> = {
            status: willRetry ? "pending" : "failed",
            last_error: errorMsg,
            attempts: currentAttempts + 1,
            processed_at: willRetry ? null : new Date().toISOString(),
        };
        if (willRetry) {
            patch.agent_id = null;
        }

        const { error: upErr } = await admin.from("print_jobs").update(patch).eq("id", jobId);

        if (upErr) {
            console.error("[agent/jobs/fail]", upErr.message);
            return NextResponse.json({ error: upErr.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, will_retry: willRetry });
    } catch (e: any) {
        console.error("[agent/jobs/fail]", e);
        return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }
}
