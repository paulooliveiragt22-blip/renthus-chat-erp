import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { orderItemsForAdminRpc } from "@/lib/server/orders/rpcAdminOrderItems";
import {
    assertFulfillmentAllowed,
    loadFulfillmentPolicy,
    parseFulfillmentType,
    PICKUP_ADDRESS_LABEL,
    type FulfillmentType,
} from "@/lib/delivery/fulfillment";

export type CreateAdminOrderPayload = {
    customer_id?: string | null;
    /** Se sem customer_id: upsert por nome/telefone no sync. */
    customer_name?: string | null;
    customer_phone?: string | null;
    customer_address?: string | null;
    channel?: string;
    status?: string;
    confirmation_status?: string;
    payment_method?: string;
    paid?: boolean;
    change_for?: number | null;
    delivery_fee?: number;
    delivery_address?: string | null;
    fulfillment_type?: string | null;
    total_amount?: number;
    details?: string | null;
    driver_id?: string | null;
    source?: string | null;
    items?: Array<Record<string, unknown>>;
    client_mutation_id?: string | null;
};

export type ApplyCreateAdminOrderResult =
    | { ok: true; order_id: string; alreadyDone?: boolean }
    | { ok: false; error: string; conflict?: boolean };

/**
 * Cria pedido admin (P5c offline sync) via RPC canônica.
 * Idempotência: `source = offline_admin:<client_mutation_id>`.
 */
export async function applyCreateAdminOrder(args: {
    admin: SupabaseClient;
    companyId: string;
    body: CreateAdminOrderPayload;
}): Promise<ApplyCreateAdminOrderResult> {
    const { admin, companyId, body } = args;
    const mutationId = String(body.client_mutation_id ?? "").trim();
    const offlineSource = mutationId ? `offline_admin:${mutationId}` : null;

    if (offlineSource) {
        const { data: existing } = await admin
            .from("orders")
            .select("id")
            .eq("company_id", companyId)
            .eq("source", offlineSource)
            .maybeSingle();
        if (existing?.id) {
            return { ok: true, order_id: String(existing.id), alreadyDone: true };
        }
    }

    let customerId = String(body.customer_id ?? "").trim();
    if (!customerId) {
        const name = String(body.customer_name ?? "").trim();
        const phone = String(body.customer_phone ?? "").trim();
        const address = String(body.customer_address ?? "").trim();
        if (!name || phone.length < 8) {
            return { ok: false, error: "customer_required" };
        }
        const { data: found, error: findErr } = await admin
            .from("customers")
            .select("id")
            .eq("company_id", companyId)
            .eq("phone", phone)
            .limit(1)
            .maybeSingle();
        if (findErr) return { ok: false, error: findErr.message };
        if (found?.id) {
            customerId = String(found.id);
            await admin
                .from("customers")
                .update({ name, address: address || null })
                .eq("id", customerId)
                .eq("company_id", companyId);
        } else {
            const { data: created, error: insErr } = await admin
                .from("customers")
                .insert({
                    name,
                    phone,
                    address: address || null,
                    company_id: companyId,
                })
                .select("id")
                .single();
            if (insErr) return { ok: false, error: insErr.message };
            customerId = String(created?.id ?? "").trim();
            if (!customerId) return { ok: false, error: "customer_upsert_failed" };
        }
    }

    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0) return { ok: false, error: "items_required" };

    const fulfillmentType: FulfillmentType =
        parseFulfillmentType(body.fulfillment_type) ?? "delivery";
    const policy = await loadFulfillmentPolicy(admin, companyId);
    const allowed = assertFulfillmentAllowed(policy, fulfillmentType);
    if (!allowed.ok) {
        return { ok: false, error: allowed.error, conflict: true };
    }

    const isPickup = fulfillmentType === "pickup";
    const fee = isPickup ? 0 : Number(body.delivery_fee ?? 0);
    const deliveryAddress = isPickup
        ? PICKUP_ADDRESS_LABEL
        : body.delivery_address != null
          ? String(body.delivery_address).trim() || null
          : null;
    const rpcItems = orderItemsForAdminRpc(items);
    const driverId = isPickup ? null : String(body.driver_id ?? "").trim() || null;

    const { data: orderId, error: rpcErr } = await admin.rpc("rpc_admin_upsert_order_with_items", {
        p_company_id: companyId,
        p_order_id: null,
        p_customer_id: customerId,
        p_channel: body.channel ?? "admin",
        p_status: body.status ?? "new",
        p_confirmation_status: body.confirmation_status ?? "confirmed",
        p_payment_method: body.payment_method ?? "pix",
        p_paid: !!body.paid,
        p_change_for: body.change_for ?? null,
        p_delivery_fee: fee,
        p_details: body.details != null ? String(body.details) : null,
        p_driver_id: driverId,
        p_source: offlineSource ?? (body.source != null && String(body.source).trim() !== ""
            ? String(body.source).trim()
            : "admin"),
        p_items: rpcItems,
        p_fulfillment_type: fulfillmentType,
        p_delivery_address: deliveryAddress,
    });

    if (rpcErr) return { ok: false, error: rpcErr.message };
    if (!orderId) return { ok: false, error: "order_create_failed" };
    return { ok: true, order_id: String(orderId) };
}
