import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function GET(
    _req: Request,
    ctxParams: { params: Promise<{ sessionId: string }> }
) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;
    const { sessionId } = await ctxParams;

    const { data, error } = await admin.rpc("rpc_mesa_get_session", {
        p_company_id: companyId,
        p_session_id: sessionId,
    });
    if (error) {
        const msg = error.message || "session_failed";
        const status = msg.includes("not_found") ? 404 : 500;
        return NextResponse.json({ error: msg }, { status });
    }
    return NextResponse.json(data ?? { ok: false });
}
