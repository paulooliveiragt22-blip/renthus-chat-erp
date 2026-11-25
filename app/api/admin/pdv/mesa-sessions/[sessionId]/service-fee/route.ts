import { NextResponse } from "next/server";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES } from "@/lib/billing/requirePlanFeature";
import { mesaRpcError } from "@/lib/mesa/rpcError";

export const runtime = "nodejs";

export async function POST(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "member"], "pdv.access");
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
