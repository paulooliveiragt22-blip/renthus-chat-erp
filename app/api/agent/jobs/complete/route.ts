import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyPrintAgentApiKey } from "@/lib/agent/verifyPrintAgentApiKey";

export const runtime = "nodejs";

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const rawKey: string = body?.api_key ?? "";
        const jobId: string = body?.job_id ?? "";
        const orderId: string | null = body?.order_id ?? null;
        const isReprint = Boolean(body?.is_reprint);

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
            .select("id, company_id")
            .eq("id", jobId)
            .maybeSingle();

        if (jobFetchErr || !jobRow || jobRow.company_id !== v.agent.company_id) {
            return NextResponse.json({ error: "Job não encontrado" }, { status: 404 });
        }

        // Enum job_status no Postgres: pending | processing | done | failed (não existe "completed")
        const { error: jobUpErr } = await admin
            .from("print_jobs")
            .update({ status: "done", processed_at: new Date().toISOString() })
            .eq("id", jobId);

        if (jobUpErr) {
            console.error("[agent/jobs/complete]", jobUpErr.message);
            return NextResponse.json({ error: jobUpErr.message }, { status: 500 });
        }

        if (orderId) {
            let q = admin
                .from("orders")
                .update({ printed_at: new Date().toISOString() })
                .eq("id", orderId)
                .eq("company_id", v.agent.company_id);
            if (!isReprint) {
                q = q.is("printed_at", null);
            }
            const { error: ordErr } = await q;
            if (ordErr) {
                console.error("[agent/jobs/complete] orders", ordErr.message);
                return NextResponse.json({ error: ordErr.message }, { status: 500 });
            }
        }

        return NextResponse.json({ ok: true });
    } catch (e: any) {
        console.error("[agent/jobs/complete]", e);
        return NextResponse.json({ error: "Erro interno" }, { status: 500 });
    }
}
