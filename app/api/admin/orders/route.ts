import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";

export const runtime = "nodejs";

export async function GET() {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const { data, error } = await admin
        .from("orders")
        .select(`id, status, channel, source, driver_id, total_amount, delivery_fee, payment_method, paid, change_for, created_at, details, customers ( name, phone, address ), order_items ( product_name, quantity, unit_price, line_total )`)
        .eq("company_id", companyId)
        .neq("confirmation_status", "pending_confirmation")
        .order("created_at", { ascending: false })
        .limit(500);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ orders: data ?? [] });
}

export async function PATCH(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        id?: string;
        status?: string;
        details?: string | null;
        payment_method?: string | null;
    };
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (body.status != null) patch.status = String(body.status);
    if (body.details !== undefined) patch.details = body.details;
    if (body.payment_method !== undefined) patch.payment_method = body.payment_method;

    const { data, error } = await admin
        .from("orders")
        .update(patch)
        .eq("id", id)
        .eq("company_id", companyId)
        .select("id")
        .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, order: data });
}
