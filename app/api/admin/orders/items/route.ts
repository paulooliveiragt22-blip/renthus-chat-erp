import { NextResponse } from "next/server";
import { requireCompanyAccess } from "@/lib/workspace/requireCompanyAccess";
import { orderItemsForAdminRpc } from "@/lib/server/orders/rpcAdminOrderItems";

export const runtime = "nodejs";

export async function PUT(req: Request) {
    const ctx = await requireCompanyAccess(["owner", "admin", "staff"]);
    if (!ctx.ok) return NextResponse.json({ error: ctx.error }, { status: ctx.status });
    const { admin, companyId } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
        order_id?: string;
        customer_id?: string;
        channel?: string | null;
        status?: string | null;
        confirmation_status?: string | null;
        payment_method?: string;
        paid?: boolean;
        change_for?: number | null;
        delivery_fee?: number;
        details?: string | null;
        driver_id?: string | null;
        source?: string | null;
        items?: Array<Record<string, unknown>>;
    };
    const orderId = String(body.order_id ?? "").trim();
    if (!orderId) return NextResponse.json({ error: "order_id_required" }, { status: 400 });
    const customerId = String(body.customer_id ?? "").trim();
    if (!customerId) return NextResponse.json({ error: "customer_id_required" }, { status: 400 });
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return NextResponse.json({ error: "items_required" }, { status: 400 });

    const rpcItems = orderItemsForAdminRpc(items);
    const driverId = body.driver_id != null && String(body.driver_id).trim() !== ""
        ? String(body.driver_id).trim()
        : null;

    const { data: outId, error: rpcErr } = await admin.rpc("rpc_admin_upsert_order_with_items", {
        p_company_id: companyId,
        p_order_id: orderId,
        p_customer_id: customerId,
        p_channel: body.channel != null ? String(body.channel) : "",
        p_status: body.status != null ? String(body.status) : "",
        p_confirmation_status: body.confirmation_status != null ? String(body.confirmation_status) : "",
        p_payment_method: body.payment_method ?? "pix",
        p_paid: !!body.paid,
        p_change_for: body.change_for ?? null,
        p_delivery_fee: Number(body.delivery_fee ?? 0),
        p_details: body.details != null ? String(body.details) : null,
        p_driver_id: driverId,
        p_source: body.source != null && String(body.source).trim() !== "" ? String(body.source).trim() : null,
        p_items: rpcItems,
    });

    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    if (!outId) return NextResponse.json({ error: "order_update_failed" }, { status: 500 });

    return NextResponse.json({ ok: true, order_id: outId as string });
}
