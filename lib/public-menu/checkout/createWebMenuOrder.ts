import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentMethod } from "@/src/types/contracts";
import type {
    PublicMenuCheckoutInput,
    PublicMenuCheckoutResult,
} from "@/src/types/contracts.public-menu";
import { resolveDeliveryForNeighborhood } from "@/lib/delivery/policy";
import {
    assertFulfillmentAllowed,
    isFulfillmentUnavailable,
    loadFulfillmentPolicy,
    parseFulfillmentType,
    resolveSoleFulfillmentType,
    type FulfillmentType,
} from "@/lib/delivery/fulfillment";
import {
    buildStoreClosedCustomerMessage,
    isStoreOpen,
    loadStoreHours,
} from "@/lib/delivery/hours";
import { persistEnderecoClienteFromFlow } from "@/lib/whatsapp/flows/persistEnderecoClienteRpc";
import { formatDeliveryAddressText, listCustomerAddressesForMenu } from "./addresses";
import { notifyWebMenuOrderWhatsApp } from "./notifyWhatsApp";
import { verifyWebMenuCheckoutSession } from "../sessionToken";
import { canFulfillQty } from "@/lib/products/stockPolicy";
import { buildOrderIdempotencyKey } from "@/lib/orders/buildOrderIdempotencyKey";

function isPaymentMethod(v: string): v is PaymentMethod {
    return v === "pix" || v === "cash" || v === "card";
}

export async function createWebMenuOrder(
    admin: SupabaseClient,
    params: {
        companyId: string;
        slug: string;
        sessionToken: string;
        input: PublicMenuCheckoutInput;
    }
): Promise<PublicMenuCheckoutResult> {
    const session = verifyWebMenuCheckoutSession(params.sessionToken);
    if (!session || session.companyId !== params.companyId || session.slug !== params.slug) {
        return { ok: false, error: "session_invalid" };
    }
    if (session.needsPhone || !session.phoneE164?.trim()) {
        return { ok: false, error: "session_invalid" };
    }

    const storeHours = await loadStoreHours(admin, params.companyId);
    if (!isStoreOpen(Date.now(), storeHours)) {
        return {
            ok: false,
            error: "store_closed",
            message: buildStoreClosedCustomerMessage(storeHours),
        };
    }

    const itemsIn = params.input.items ?? [];
    if (!Array.isArray(itemsIn) || itemsIn.length === 0) {
        return { ok: false, error: "empty_cart" };
    }
    if (itemsIn.length > 40) {
        return { ok: false, error: "cart_too_large" };
    }

    const paymentMethod = String(params.input.paymentMethod ?? "").trim().toLowerCase();
    if (!isPaymentMethod(paymentMethod)) {
        return { ok: false, error: "payment_invalid" };
    }

    let changeFor: number | null = null;
    if (paymentMethod === "cash") {
        const raw = params.input.changeFor;
        if (raw != null && raw !== "") {
            const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
            if (!Number.isFinite(n) || n <= 0) {
                return { ok: false, error: "change_invalid" };
            }
            changeFor = n;
        }
    }

    // Revalida preços no servidor
    const embalagemIds = [...new Set(itemsIn.map((i) => String(i.embalagemId ?? "").trim()).filter(Boolean))];
    if (embalagemIds.length === 0) return { ok: false, error: "empty_cart" };

    const { data: embRows, error: embErr } = await admin
        .from("produto_embalagens")
        .select("id, preco_venda, produto_id, fator_conversao, product_volume_id, siglas_comerciais(sigla)")
        .in("id", embalagemIds)
        .eq("company_id", params.companyId);

    if (embErr || !embRows?.length) {
        return { ok: false, error: "items_unavailable" };
    }

    const productIds = [
        ...new Set(
            embRows.map((r) => String((r as { produto_id: string }).produto_id)).filter(Boolean)
        ),
    ];
    const volumeIds = [
        ...new Set(
            embRows
                .map((r) => (r as { product_volume_id?: string | null }).product_volume_id)
                .filter((id): id is string => Boolean(id))
        ),
    ];

    const [{ data: productRows }, { data: volumeRows }] = await Promise.all([
        admin
            .from("products")
            .select("id, name, is_active, show_on_menu, vender_com_estoque_zero")
            .in("id", productIds)
            .eq("company_id", params.companyId),
        volumeIds.length
            ? admin.from("product_volumes").select("id, estoque_atual").in("id", volumeIds)
            : Promise.resolve({ data: [] as Array<{ id: string; estoque_atual: number }> }),
    ]);

    const productsById = new Map(
        (productRows ?? []).map((p) => [
            String(p.id),
            p as {
                id: string;
                name: string;
                is_active: boolean;
                show_on_menu: boolean | null;
                vender_com_estoque_zero?: boolean | null;
            },
        ])
    );
    const estoqueByVolume = new Map(
        (volumeRows ?? []).map((v) => [String(v.id), Number(v.estoque_atual ?? 0)])
    );

    type EmbRow = {
        id: string;
        preco_venda: number | string;
        produto_id: string;
        fator_conversao?: number | string | null;
        product_volume_id?: string | null;
        siglas_comerciais: { sigla: string } | { sigla: string }[] | null;
    };
    const embById = new Map(
        (embRows as unknown as EmbRow[]).map((r) => [String(r.id), r])
    );

    const orderItems: Array<{
        product_name: string;
        produto_embalagem_id: string;
        quantity: number;
        unit_price: number;
    }> = [];

    let subtotal = 0;
    for (const line of itemsIn) {
        const id = String(line.embalagemId ?? "").trim();
        const qty = Math.floor(Number(line.qty));
        if (!id || !Number.isFinite(qty) || qty < 1 || qty > 99) {
            return { ok: false, error: "qty_invalid" };
        }
        const row = embById.get(id);
        if (!row) return { ok: false, error: "items_unavailable" };
        const product = productsById.get(String(row.produto_id));
        if (!product || product.is_active === false || product.show_on_menu === false) {
            return { ok: false, error: "items_unavailable" };
        }
        const estoque = row.product_volume_id
            ? (estoqueByVolume.get(String(row.product_volume_id)) ?? 0)
            : 0;
        if (
            !canFulfillQty({
                venderComEstoqueZero: product.vender_com_estoque_zero,
                estoqueUnidades: estoque,
                fatorConversao: Number(row.fator_conversao ?? 1) || 1,
                qty,
            })
        ) {
            return { ok: false, error: "items_unavailable" };
        }
        const unitPrice = Number(row.preco_venda);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            return { ok: false, error: "items_unavailable" };
        }
        const siglaRaw = Array.isArray(row.siglas_comerciais)
            ? row.siglas_comerciais[0]?.sigla
            : row.siglas_comerciais?.sigla;
        const sigla = String(siglaRaw ?? "UN").trim().toUpperCase() || "UN";
        const productName =
            sigla === "UN" || sigla === "UND" || sigla === "UNID"
                ? product.name
                : `${product.name} (${sigla})`;
        orderItems.push({
            product_name: productName,
            produto_embalagem_id: id,
            quantity: qty,
            unit_price: unitPrice,
        });
        subtotal += unitPrice * qty;
    }

    const policy = await loadFulfillmentPolicy(admin, params.companyId);
    if (isFulfillmentUnavailable(policy)) {
        return { ok: false, error: "fulfillment_unavailable" };
    }

    let fulfillmentType: FulfillmentType | null = parseFulfillmentType(params.input.fulfillmentType);
    if (!fulfillmentType) {
        fulfillmentType = resolveSoleFulfillmentType(policy);
    }
    if (!fulfillmentType) {
        return { ok: false, error: "fulfillment_required" };
    }
    const allowed = assertFulfillmentAllowed(policy, fulfillmentType);
    if (!allowed.ok) {
        return { ok: false, error: allowed.error };
    }

    const isPickup = fulfillmentType === "pickup";

    let deliveryEnderecoClienteId: string | null = null;
    let addressText = isPickup ? "Retirada no local" : "";
    let bairro = "";
    let deliveryFee = 0;
    let etaMin: number | null = null;

    if (!isPickup) {
        const selectedId = params.input.savedAddressId
            ? String(params.input.savedAddressId).trim()
            : "";

        if (selectedId) {
            const addresses = await listCustomerAddressesForMenu(
                admin,
                params.companyId,
                session.customerId
            );
            const found = addresses.find((a) => a.id === selectedId);
            if (!found) return { ok: false, error: "address_not_found" };
            deliveryEnderecoClienteId = found.id;
            bairro = found.bairro ?? "";
            addressText = formatDeliveryAddressText(found);
        } else {
            const a = params.input.newAddress;
            if (!a) return { ok: false, error: "address_required" };
            const logradouro = String(a.logradouro ?? "").trim();
            const numero = String(a.numero ?? "").trim();
            bairro = String(a.bairro ?? "").trim();
            const cidade = String(a.cidade ?? "").trim();
            const estado = String(a.estado ?? "").trim().toUpperCase().slice(0, 2);
            if (!logradouro || !numero || !bairro || !cidade || estado.length !== 2) {
                return { ok: false, error: "address_incomplete" };
            }
            const persisted = await persistEnderecoClienteFromFlow(admin, {
                companyId: params.companyId,
                customerId: session.customerId,
                existingAddressId: null,
                apelido: String(a.apelido ?? "").trim() || "Cardápio web",
                logradouro,
                numero,
                complemento: String(a.complemento ?? "").trim() || null,
                bairro,
                cidade,
                estado,
                cep: a.cep == null ? null : String(a.cep),
            });
            if (!persisted.ok) return { ok: false, error: "address_persist_failed" };
            deliveryEnderecoClienteId = persisted.id;
            addressText = formatDeliveryAddressText({
                logradouro,
                numero,
                complemento: a.complemento,
                bairro,
                cidade,
                estado,
            });
        }

        const delivery = await resolveDeliveryForNeighborhood(admin, params.companyId, bairro);
        if (!delivery.served) {
            return { ok: false, error: "delivery_not_served", message: delivery.reason ?? undefined };
        }

        deliveryFee = delivery.fee;
        etaMin = delivery.eta_min;

        const grandCheck = subtotal + deliveryFee;
        if (delivery.min_order != null && grandCheck + 1e-9 < delivery.min_order) {
            return {
                ok: false,
                error: "min_order_not_met",
                message: `Pedido mínimo: R$ ${delivery.min_order.toFixed(2).replace(".", ",")}`,
                minOrder: delivery.min_order,
                grandTotal: grandCheck,
            };
        }
    }

    const grandTotal = subtotal + deliveryFee;

    if (paymentMethod === "cash" && changeFor != null && changeFor + 1e-9 < grandTotal) {
        return { ok: false, error: "change_below_total" };
    }

    const { data: settings } = await admin
        .from("company_settings")
        .select("require_order_approval")
        .eq("company_id", params.companyId)
        .maybeSingle();

    const requireApproval = Boolean(settings?.require_order_approval);
    const confirmationStatus = requireApproval ? "pending_confirmation" : "confirmed";

    const idempotencyKey = buildOrderIdempotencyKey({
        source: "web_menu",
        scopeId: session.customerId,
        items: orderItems.map((i) => ({
            produtoEmbalagemId: i.produto_embalagem_id,
            quantity: i.quantity,
            unitPrice: i.unit_price,
        })),
        grandTotal,
        paymentMethod,
    });

    const { data: orderId, error: orderErr } = await admin.rpc("create_order_with_items", {
        p_company_id: params.companyId,
        p_customer_id: session.customerId,
        p_status: "new",
        p_confirmation_status: confirmationStatus,
        p_source: "web_menu",
        p_channel: "web",
        p_total_amount: grandTotal,
        p_total: subtotal,
        p_delivery_fee: deliveryFee,
        p_delivery_address: addressText,
        p_delivery_endereco_cliente_id: deliveryEnderecoClienteId,
        p_payment_method: paymentMethod,
        p_change_for: changeFor,
            p_paid: false,
            p_items: orderItems,
            p_idempotency_key: idempotencyKey,
            p_fulfillment_type: fulfillmentType,
    });

    if (orderErr || !orderId) {
        console.error("[public-menu] create_order_with_items:", orderErr?.message);
        return { ok: false, error: "order_failed" };
    }

    const code = `#${String(orderId).replaceAll("-", "").slice(-6).toUpperCase()}`;

    await notifyWebMenuOrderWhatsApp({
        admin,
        companyId: params.companyId,
        phoneE164: session.phoneE164,
        orderCode: code,
        requireApproval,
        items: orderItems,
        deliveryFee,
        grandTotal,
        deliveryAddress: addressText,
        paymentMethod,
        changeFor,
        etaMin,
        fulfillmentType,
    });

    return {
        ok: true,
        orderId: String(orderId),
        orderCode: code,
        requireApproval,
        subtotal,
        deliveryFee,
        grandTotal,
        deliveryAddress: addressText,
        etaMin,
    };
}
