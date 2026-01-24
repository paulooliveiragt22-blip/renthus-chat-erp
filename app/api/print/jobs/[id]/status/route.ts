// app/api/print/jobs/[id]/status/route.ts
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyAgentByApiKey, updateAgentLastSeen } from "@/lib/print/agents";

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const jobId = params.id;
    const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const agent = await verifyAgentByApiKey(auth);
    if (!agent) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const status = String(body?.status || "").trim(); // 'done' | 'failed'
    const errorText = body?.error ? String(body.error) : null;

    if (!["done", "failed"].includes(status)) {
        return NextResponse.json({ error: "invalid status" }, { status: 400 });
    }

    const admin = createAdminClient();

    // verify job exists and belongs to agent.company_id
    const { data: job, error: fetchErr } = await admin.from("print_jobs").select("*").eq("id", jobId).maybeSingle();
    if (fetchErr || !job) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (String(job.company_id) !== String(agent.company_id)) {
        return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const updates: any = {
        status,
        processed_at: new Date().toISOString()
    };
    if (errorText) updates.error = errorText;
    // optionally set processed_by to agent.id (if not set earlier)
    updates.processed_by = agent.id;

    const { error: updErr } = await admin.from("print_jobs").update(updates).eq("id", jobId);
    if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    // If done and has order_id, update orders.printed_at (optional)
    if (status === "done" && job.order_id) {
        try {
            await admin.from("orders").update({ printed_at: new Date().toISOString() }).eq("id", job.order_id);
        } catch (e) {
            // ignore
        }
    }

    // update agent last_seen
    updateAgentLastSeen(agent.id).catch(() => { });

    return NextResponse.json({ ok: true });
}
