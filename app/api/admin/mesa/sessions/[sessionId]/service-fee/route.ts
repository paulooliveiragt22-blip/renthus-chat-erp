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
    const body = (await req.json().catch(() => ({}))) as { waived?: boolean };
    const { data, error } = await admin.rpc("rpc_mesa_set_service_fee", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_waived: body.waived === true,
    });
    if (error) return mesaRpcError(error, "service_fee_failed");
    return NextResponse.json(data ?? { ok: true });
}
