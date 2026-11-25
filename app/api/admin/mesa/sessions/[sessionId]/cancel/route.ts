import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { mesaRpcError } from "@/lib/mesa/rpcError";

export const runtime = "nodejs";

export async function POST(
    _req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "member"], "mesa.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams.params;
    const { data, error } = await admin.rpc("rpc_mesa_cancel_session", {
        p_company_id: companyId,
        p_session_id: sessionId,
    });
    if (error) return mesaRpcError(error, "cancel_failed");
    return NextResponse.json(data ?? { ok: true });
}
