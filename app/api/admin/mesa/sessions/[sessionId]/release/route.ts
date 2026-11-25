import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";
import { mesaRpcError } from "@/lib/mesa/rpcError";
import { normalizeMesaReleaseParts } from "@/lib/mesa/normalizeReleaseParts";

export const runtime = "nodejs";

export async function POST(
    req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "member"], "mesa.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams.params;
    const body = (await req.json().catch(() => ({}))) as { parts?: unknown };
    const normalized = await normalizeMesaReleaseParts(admin, companyId, body.parts);
    if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });

    const { data, error } = await admin.rpc("rpc_mesa_release_table", {
        p_company_id: companyId,
        p_session_id: sessionId,
        p_payload: { parts: normalized.parts },
    });
    if (error) return mesaRpcError(error, "release_failed");
    return NextResponse.json(data ?? { ok: true });
}
