import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
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
import { persistEnderecoCliente } from "@/lib/customers/persistEnderecoCliente";
import { formatDeliveryAddressText, listCustomerAddressesForMenu } from "./addresses";
import { notifyWebMenuOrder } from "./notifyWhatsApp";
import { consumeCheckoutHandoffAfterWebOrder } from "@/lib/public-menu/handoff/consumeCheckoutHandoff";
import { verifyWebMenuCheckoutSession } from "../sessionToken";
import { canFulfillQty } from "@/lib/products/stockPolicy";
import { buildOrderIdempotencyKey } from "@/lib/orders/buildOrderIdempotencyKey";
import { loadAcceptedCustomerPayments } from "@/lib/payments/loadAcceptedCustomerPayments";
import { assertCustomerPaymentAllowed } from "@/src/financeiro/domain/acceptedCustomerPayments";
import { sanitizeOrderNotes } from "@/lib/orders/sanitizeOrderNotes";

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

    const paymentRaw = String(params.input.paymentMethod ?? "").trim().toLowerCase();
    const accepted = await loadAcceptedCustomerPayments(admin, params.companyId);
    const payCheck = assertCustomerPaymentAllowed(accepted, paymentRaw);
    if (!payCheck.ok) {
        return { ok: false, error: payCheck.error };
    }
    const paymentMethod = payCheck.method;
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
        produto_embalagem_id?: string;
        combo_id?: string;
        quantity: number;
    }> = [];

    for (const line of itemsIn) {
        const comboId = String(line.comboId ?? "").trim();
        const id = String(line.embalagemId ?? "").trim();
        const qty = Math.floor(Number(line.qty));
        if ((!id && !comboId) || !Number.isFinite(qty) || qty < 1 || qty > 99) {
            return { ok: false, error: "qty_invalid" };
        }
        if (comboId) {
            orderItems.push({ product_name: "Combo", combo_id: comboId, quantity: qty });
            continue;
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
        orderItems.push({
            product_name: product.name,
            produto_embalagem_id: id,
            quantity: qty,
        });
    }

    const { data: quoted, error: quoteErr } = await admin.rpc("rpc_quote_sale_lines", {
        p_company_id: params.companyId,
        p_items: orderItems.map((i) => ({
            produto_embalagem_id: i.produto_embalagem_id ?? null,
            combo_id: i.combo_id ?? null,
            quantity: i.quantity,
        })),
    });
    if (quoteErr || !quoted || typeof quoted !== "object") {
        const msg = quoteErr?.message ?? "";
        if (
            msg.includes("combo_sem_estoque") ||
            msg.includes("combo_indisponivel") ||
            msg.includes("not_in_company")
        ) {
            return { ok: false, error: "items_unavailable" };
        }
        return { ok: false, error: "order_failed" };
    }
    const subtotal = Number((quoted as { subtotal?: unknown }).subtotal);
    if (!Number.isFinite(subtotal) || subtotal <= 0) {
        return { ok: false, error: "items_unavailable" };
    }
    const quotedLines = Array.isArray((quoted as { lines?: unknown }).lines)
        ? (quoted as { lines: unknown[] }).lines
        : [];
    const notifyItems = quotedLines.flatMap((line) => {
        if (!line || typeof line !== "object") return [];
        const row = line as {
            product_name?: unknown;
            quantity?: unknown;
            unit_price?: unknown;
            combo_label?: unknown;
        };
        const name = String(row.product_name ?? "").trim();
        const qty = Number(row.quantity);
        const price = Number(row.unit_price);
        if (!name || !Number.isFinite(qty) || !Number.isFinite(price)) return [];
        const kit = typeof row.combo_label === "string" ? row.combo_label.trim() : "";
        return [{
            product_name: kit ? `${kit}: ${name}` : name,
            quantity: qty,
            unit_price: price,
        }];
    });

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
            const persisted = await persistEnderecoCliente(admin, {
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
            produtoEmbalagemId: i.combo_id ?? i.produto_embalagem_id,
            quantity: i.quantity,
            unitPrice: 0,
        })),
        grandTotal,
        paymentMethod,
        attemptId: params.input.idempotencyKey,
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
        p_order_notes: sanitizeOrderNotes(params.input.notes),
    });

    if (orderErr || !orderId) {
        console.error("[public-menu] create_order_with_items:", orderErr?.message);
        return { ok: false, error: "order_failed" };
    }

    const code = `#${String(orderId).replaceAll("-", "").slice(-6).toUpperCase()}`;

    await notifyWebMenuOrder({
        admin,
        companyId: params.companyId,
        customerId: session.customerId,
        phoneE164: session.phoneE164,
        originChannel: session.channel,
        originExternalId: session.externalId,
        orderCode: code,
        requireApproval,
        items: notifyItems,
        deliveryFee,
        grandTotal,
        deliveryAddress: addressText,
        paymentMethod,
        changeFor,
        etaMin,
        fulfillmentType,
        notes: sanitizeOrderNotes(params.input.notes),
    });

    // C1b.3: um efeito — handoff consumido + draft WA limpo (best-effort; não falha o pedido)
    try {
        await consumeCheckoutHandoffAfterWebOrder(admin, {
            companyId: params.companyId,
            slug: params.slug,
            handoffToken: params.input.handoffToken,
        });
    } catch (err) {
        console.warn(
            "[public-menu] consumeCheckoutHandoffAfterWebOrder:",
            err instanceof Error ? err.message : err
        );
    }

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
