import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { requirePlanFeature } from "@/lib/billing/requirePlanFeature";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const feat = await requirePlanFeature(admin, companyId, "printing_auto");
    if (!feat.ok) return feat.response;

    const { data, error } = await admin
        .from("print_jobs")
        .select("id, order_id, status, copy_type, processed_at, created_at, orders ( id, total_amount, printed_at, customers ( name ) )")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(40);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const jobs = ((data ?? []) as Record<string, unknown>[]).map((row) => {
        const ord = (row.orders ?? {}) as Record<string, unknown>;
        const customers = ord.customers;
        const customerName = Array.isArray(customers)
            ? (customers[0] as Record<string, unknown> | undefined)?.name
            : (customers as Record<string, unknown> | undefined)?.name;

        return {
            id: String(row.id ?? ""),
            order_id: String(row.order_id ?? ""),
            status: String(row.status ?? "pending"),
            copy_type: String(row.copy_type ?? "cashier"),
            printed_at: String(ord.printed_at ?? row.processed_at ?? row.created_at ?? ""),
            total_amount: ord.total_amount == null ? null : Number(ord.total_amount),
            customer_name: customerName == null ? null : String(customerName),
        };
    });

    return NextResponse.json({ jobs });
}
