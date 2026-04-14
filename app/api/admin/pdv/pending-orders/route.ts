import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("orders")
        .select("id, customer_name, total_amount, status, created_at, source, channel")
        .eq("company_id", companyId)
        .in("status", ["new", "confirmed", "preparing", "delivering"])
        .is("sale_id", null)
        .order("created_at", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ orders: data ?? [] });
}
