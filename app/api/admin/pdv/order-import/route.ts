import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const orderId = String(req.nextUrl.searchParams.get("order_id") ?? "").trim();
    if (!orderId) return NextResponse.json({ error: "order_id_required" }, { status: 400 });

    const { data: orderRow, error: ordErr } = await admin
        .from("orders")
        .select("id, source, company_id")
        .eq("id", orderId)
        .eq("company_id", companyId)
        .maybeSingle();
    if (ordErr) return NextResponse.json({ error: ordErr.message }, { status: 500 });
    if (!orderRow) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const { data: items, error: itemsErr } = await admin
        .from("order_items")
        .select("produto_embalagem_id, quantity, qty, product_name, unit_price")
        .eq("order_id", orderId);
    if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

    return NextResponse.json({ source: orderRow.source ?? null, items: items ?? [] });
}
