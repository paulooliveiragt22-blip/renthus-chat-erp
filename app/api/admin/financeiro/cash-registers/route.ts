import { NextResponse } from "next/server";
import { requireCompanyPlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyPlanFeature("financeiro_full", ["owner", "admin", "member"], "financeiro.read");
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("cash_registers")
        .select("id, opened_at, closed_at, operator_name, initial_amount, closing_amount, difference, status")
        .eq("company_id", companyId)
        .order("opened_at", { ascending: false })
        .limit(30);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ registers: data ?? [] });
}
