import { NextResponse } from "next/server";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAnyPlanFeature([...PDV_ACCESS_FEATURES], ["owner", "admin", "staff"]);
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("orders")
        .select("id, customer_name, total_amount, status, created_at, source, channel")
        .eq("company_id", companyId)
        .in("status", ["new", "preparing", "delivered"])
        .is("sale_id", null)
        .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ orders: data ?? [] });
}
