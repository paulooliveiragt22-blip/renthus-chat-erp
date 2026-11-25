import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { mesaRpcError } from "@/lib/mesa/rpcError";

export const runtime = "nodejs";

export async function POST(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "member"], "mesa.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams.params;
    const body = (await req.json().catch(() => ({}))) as { tableId?: string };
    const tableId = String(body.tableId ?? "").trim();
    if (!tableId) return NextResponse.json({ error: "table_id_required" }, { status: 400 });

    const { data, error } = await admin.rpc("rpc_mesa_transfer_session", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_target_table_id: tableId,
    });
    if (error) return mesaRpcError(error, "transfer_failed");
    return NextResponse.json(data ?? { ok: true });
}
