import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function POST(req: Request) {
    const ctx = await requireCompanyPlanFeature("table_service", ["owner", "admin"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const { data, error } = await admin.rpc("rpc_mesa_upsert_table", {
        p_company_id: companyId,
        p_payload: body,
    });
    if (error) {
        const msg = error.message || "upsert_failed";
        const status = msg.includes("code_required") ? 400 : 500;
        return NextResponse.json({ error: msg }, { status });
    }
    return NextResponse.json(data ?? { ok: true });
}
