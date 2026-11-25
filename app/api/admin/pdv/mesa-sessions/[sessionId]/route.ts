import { NextResponse } from "next/server";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES } from "@/lib/billing/requirePlanFeature";
import { mesaRpcError } from "@/lib/mesa/rpcError";
import { normalizeMesaReleaseParts } from "@/lib/mesa/normalizeReleaseParts";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ sessionId: string }> };

export async function GET(_req: Request, ctxParams: RouteCtx) {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "member"], "pdv.access");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams.params;
    const { data, error } = await admin.rpc("rpc_mesa_get_session", {
        p_company_id: companyId,
        p_session_id: sessionId,
    });
    if (error) return mesaRpcError(error, "session_failed");
    return NextResponse.json(data ?? { ok: true });
}

export async function POST(req: Request, ctxParams: RouteCtx) {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "member"], "pdv.access");
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
