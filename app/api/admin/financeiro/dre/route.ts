import { NextRequest, NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyPlanFeature("financeiro_full", ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const from = String(req.nextUrl.searchParams.get("from") ?? "").trim();
    const to = String(req.nextUrl.searchParams.get("to") ?? "").trim();
    if (!from || !to) return NextResponse.json({ error: "from_to_required" }, { status: 400 });

    const fromMonth = `${from.slice(0, 7)}-01`;
    const toMonth = `${to.slice(0, 7)}-01`;

    const { data: dreRows, error } = await admin
        .from("v_dre")
        .select("account_name, account_type, total")
        .eq("company_id", companyId)
        .lte("period_start", toMonth)
        .gte("period_end", fromMonth);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: dreRows ?? [] });
}
