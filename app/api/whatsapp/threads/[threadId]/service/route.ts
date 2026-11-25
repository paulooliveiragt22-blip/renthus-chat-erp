import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { callServiceRpc } from "@/src/service/http/serviceRpcResult";

export const runtime = "nodejs";

export async function GET(
    _req: Request,
    { params }: { params: Promise<{ threadId: string }> }
) {
    const ctx = await requireCapability("whatsapp.operate");
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { threadId } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(threadId)) {
        return NextResponse.json({ error: "invalid_thread" }, { status: 400 });
    }

    const [appointments, cases, snapshot] = await Promise.all([
        callServiceRpc(ctx.admin, "rpc_service_list_thread_appointments", {
            p_company_id: ctx.companyId,
            p_thread_id: threadId,
        }),
        callServiceRpc(ctx.admin, "rpc_service_list_thread_cases", {
            p_company_id: ctx.companyId,
            p_thread_id: threadId,
        }),
        callServiceRpc(ctx.admin, "rpc_service_admin_snapshot", {
            p_company_id: ctx.companyId,
        }),
    ]);

    if (snapshot.status === 403) {
        return NextResponse.json(snapshot.body, { status: 403 });
    }

    return NextResponse.json({
        snapshot: snapshot.body,
        appointments: appointments.body,
        cases: cases.body,
    });
}
