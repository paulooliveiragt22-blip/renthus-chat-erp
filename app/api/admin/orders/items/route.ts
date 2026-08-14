import { NextResponse } from "next/server";
import { requireCapability } from "@/lib/workspace/rbac/requireCapability";
import { orderItemsForAdminRpc } from "@/lib/server/orders/rpcAdminOrderItems";
import {
    assertFulfillmentAllowed,
    loadFulfillmentPolicy,
    parseFulfillmentType,
    PICKUP_ADDRESS_LABEL,
    type FulfillmentType,
} from "@/lib/delivery/fulfillment";

export const runtime = "nodejs";

export async function PUT(req: Request) {
    const ctx = await requireCapability("orders.read");
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
        delivery_address?: string | null;
        fulfillment_type?: string | null;
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

    let fulfillmentType: FulfillmentType =
        parseFulfillmentType(body.fulfillment_type) ?? "delivery";
    if (body.fulfillment_type == null) {
        const { data: existing } = await admin
            .from("orders")
            .select("fulfillment_type")
            .eq("id", orderId)
            .eq("company_id", companyId)
            .maybeSingle();
        fulfillmentType = parseFulfillmentType(existing?.fulfillment_type) ?? "delivery";
    }

    const policy = await loadFulfillmentPolicy(admin, companyId);
    const allowed = assertFulfillmentAllowed(policy, fulfillmentType);
    if (!allowed.ok) {
        return NextResponse.json({ error: allowed.error }, { status: 409 });
    }

    const isPickup = fulfillmentType === "pickup";
    const fee = isPickup ? 0 : Number(body.delivery_fee ?? 0);
    const deliveryAddress = isPickup
        ? PICKUP_ADDRESS_LABEL
        : body.delivery_address != null
          ? String(body.delivery_address).trim() || null
          : null;
    const rpcItems = orderItemsForAdminRpc(items);
    const driverId = isPickup
        ? null
        : body.driver_id != null && String(body.driver_id).trim() !== ""
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
        p_delivery_fee: fee,
        p_details: body.details != null ? String(body.details) : null,
        p_driver_id: driverId,
        p_source: body.source != null && String(body.source).trim() !== "" ? String(body.source).trim() : null,
        p_items: rpcItems,
        p_fulfillment_type: fulfillmentType,
        p_delivery_address: deliveryAddress,
    });

    if (rpcErr) return NextResponse.json({ error: rpcErr.message }, { status: 500 });
    if (!outId) return NextResponse.json({ error: "order_update_failed" }, { status: 500 });

    return NextResponse.json({ ok: true, order_id: outId as string });
}
