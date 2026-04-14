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
        paid?: boolean;
        change_for?: number | null;
        customer_id?: string;
        delivery_fee?: number;
        total_amount?: number;
        driver_id?: string | null;
    };
    const id = String(body.id ?? "").trim();
    if (!id) return NextResponse.json({ error: "id_required" }, { status: 400 });

    const patch: Record<string, unknown> = {};
    if (body.status != null) patch.status = String(body.status);
    if (body.details !== undefined) patch.details = body.details;
    if (body.payment_method !== undefined) patch.payment_method = body.payment_method;
    if (body.paid !== undefined) patch.paid = !!body.paid;
    if (body.change_for !== undefined) patch.change_for = body.change_for;
    if (body.customer_id !== undefined) patch.customer_id = String(body.customer_id);
    if (body.delivery_fee !== undefined) patch.delivery_fee = Number(body.delivery_fee ?? 0);
    if (body.total_amount !== undefined) patch.total_amount = Number(body.total_amount ?? 0);
    if (body.driver_id !== undefined) patch.driver_id = body.driver_id || null;

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

export async function POST(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        customer_id?: string;
        channel?: string;
        status?: string;
        payment_method?: string;
        paid?: boolean;
        change_for?: number | null;
        delivery_fee?: number;
        total_amount?: number;
        details?: string | null;
        driver_id?: string | null;
        items?: Array<Record<string, unknown>>;
    };

    const customerId = String(body.customer_id ?? "").trim();
    if (!customerId) return NextResponse.json({ error: "customer_id_required" }, { status: 400 });

    const { data: order, error: ordErr } = await admin
        .from("orders")
        .insert({
            company_id: companyId,
            customer_id: customerId,
            channel: body.channel ?? "admin",
            status: body.status ?? "new",
            payment_method: body.payment_method ?? "pix",
            paid: !!body.paid,
            change_for: body.change_for ?? null,
            delivery_fee: Number(body.delivery_fee ?? 0),
            total_amount: Number(body.total_amount ?? 0),
            details: body.details ?? null,
            driver_id: body.driver_id ?? null,
        })
        .select("id")
        .single();
    if (ordErr) return NextResponse.json({ error: ordErr.message }, { status: 500 });

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length > 0) {
        const payload = items.map((it) => ({ ...it, order_id: order.id, company_id: companyId }));
        const { error: itemsErr } = await admin.from("order_items").insert(payload);
        if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, order_id: order.id as string });
}
