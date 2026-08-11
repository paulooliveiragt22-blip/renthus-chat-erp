import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketplaceExternalOrder } from "@/src/types/contracts.marketplace-orders";
import type { MarketplaceProvider } from "@/src/types/contracts.marketplace";
import { normalizeBrPhone } from "@/lib/public-menu/phone";

function mapPayment(m: string): string {
    const x = m.toLowerCase();
    if (x === "pix" || x === "cash" || x === "card") return x;
    return "pix"; // online marketplace → trata como pix no ERP
}

async function resolveCustomer(
    admin: SupabaseClient,
    companyId: string,
    phoneRaw: string | null,
    name: string | null
): Promise<string | null> {
    const phone = phoneRaw ? normalizeBrPhone(phoneRaw) : null;
    if (phone?.ok) {
        const { data: existing } = await admin
            .from("customers")
            .select("id")
            .eq("company_id", companyId)
            .or(
                `phone_e164.eq.${phone.phoneE164},phone.eq.${phone.digits},phone.eq.${phone.phoneE164}`
            )
            .limit(1)
            .maybeSingle();
        if (existing?.id) return String(existing.id);

        const { data: created } = await admin
            .from("customers")
            .insert({
                company_id: companyId,
                phone: phone.digits,
                phone_e164: phone.phoneE164,
                name: (name ?? "Cliente marketplace").slice(0, 120),
                origem: "marketplace",
            })
            .select("id")
            .single();
        return created?.id ? String(created.id) : null;
    }

    const { data: created } = await admin
        .from("customers")
        .insert({
            company_id: companyId,
            phone: `mkt-${Date.now()}`,
            name: (name ?? "Cliente marketplace").slice(0, 120),
            origem: "marketplace",
        })
        .select("id")
        .single();
    return created?.id ? String(created.id) : null;
}

async function resolveEmbalagemId(
    admin: SupabaseClient,
    companyId: string,
    provider: MarketplaceProvider,
    externalItemId: string | null
): Promise<string | null> {
    if (!externalItemId) return null;
    const { data } = await admin
        .from("marketplace_catalog_map")
        .select("produto_embalagem_id")
        .eq("company_id", companyId)
        .eq("provider", provider)
        .eq("external_item_id", externalItemId)
        .maybeSingle();
    return data?.produto_embalagem_id ? String(data.produto_embalagem_id) : null;
}

export async function importMarketplaceOrder(
    admin: SupabaseClient,
    companyId: string,
    provider: MarketplaceProvider,
    external: MarketplaceExternalOrder
): Promise<{ ok: true; orderId: string; created: boolean } | { ok: false; error: string }> {
    const { data: existing } = await admin
        .from("marketplace_external_orders")
        .select("id, order_id")
        .eq("company_id", companyId)
        .eq("provider", provider)
        .eq("external_order_id", external.externalOrderId)
        .maybeSingle();

    if (existing?.order_id) {
        return { ok: true, orderId: String(existing.order_id), created: false };
    }

    const customerId = await resolveCustomer(
        admin,
        companyId,
        external.customerPhone,
        external.customerName
    );
    if (!customerId) return { ok: false, error: "customer_failed" };

    const items = [];
    for (const line of external.items) {
        const embalagemId = await resolveEmbalagemId(
            admin,
            companyId,
            provider,
            line.externalItemId
        );
        items.push({
            product_name: line.name,
            produto_embalagem_id: embalagemId,
            quantity: line.quantity,
            unit_price: line.unitPrice,
        });
    }
    if (items.length === 0) return { ok: false, error: "empty_items" };

    const subtotal = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
    const deliveryFee = Number(external.deliveryFee ?? 0) || 0;
    const grandTotal = subtotal + deliveryFee;

    const { data: settings } = await admin
        .from("company_settings")
        .select("require_order_approval")
        .eq("company_id", companyId)
        .maybeSingle();
    const requireApproval = Boolean(settings?.require_order_approval);
    const source = provider === "aiqfome" ? "marketplace_aiqfome" : "marketplace_ifood";

    const { data: orderId, error: orderErr } = await admin.rpc("create_order_with_items", {
        p_company_id: companyId,
        p_customer_id: customerId,
        p_status: "new",
        p_confirmation_status: requireApproval ? "pending_confirmation" : "confirmed",
        p_source: source,
        p_channel: "marketplace",
        p_total_amount: grandTotal,
        p_total: subtotal,
        p_delivery_fee: deliveryFee,
        p_delivery_address: external.deliveryAddress ?? "Marketplace",
        p_delivery_endereco_cliente_id: null,
        p_payment_method: mapPayment(String(external.paymentMethod)),
        p_change_for: null,
        p_paid: String(external.paymentMethod).toLowerCase() === "online",
        p_items: items,
        p_idempotency_key: `marketplace_${provider}:${external.externalOrderId}`,
    });

    if (orderErr || !orderId) {
        console.error("[marketplace/import] create_order:", orderErr?.message);
        return { ok: false, error: orderErr?.message ?? "order_failed" };
    }

    const detailsNote = [
        `Pedido ${provider.toUpperCase()}`,
        external.displayId ? `#${external.displayId}` : null,
        `ext:${external.externalOrderId}`,
    ]
        .filter(Boolean)
        .join(" · ");

    await admin
        .from("orders")
        .update({ details: detailsNote })
        .eq("id", orderId)
        .eq("company_id", companyId);

    await admin.from("marketplace_external_orders").upsert(
        {
            company_id: companyId,
            provider,
            external_order_id: external.externalOrderId,
            order_id: orderId,
            external_status: external.externalStatus,
            display_id: external.displayId,
            raw_payload: external.raw,
            updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,provider,external_order_id" }
    );

    return { ok: true, orderId: String(orderId), created: true };
}
