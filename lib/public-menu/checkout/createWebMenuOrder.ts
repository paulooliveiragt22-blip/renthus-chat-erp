import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentMethod } from "@/src/types/contracts";
import type {
    PublicMenuCheckoutInput,
    PublicMenuCheckoutResult,
} from "@/src/types/contracts.public-menu";
import { resolveDeliveryForNeighborhood } from "@/lib/delivery/policy";
import { persistEnderecoClienteFromFlow } from "@/lib/whatsapp/flows/persistEnderecoClienteRpc";
import { formatDeliveryAddressText, listCustomerAddressesForMenu } from "./addresses";
import { verifyWebMenuCheckoutSession } from "../sessionToken";

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
        .select("id, preco_venda, produto_id")
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
    const { data: productRows } = await admin
        .from("products")
        .select("id, name, is_active, show_on_menu")
        .in("id", productIds)
        .eq("company_id", params.companyId);

    const productsById = new Map(
        (productRows ?? []).map((p) => [
            String(p.id),
            p as {
                id: string;
                name: string;
                is_active: boolean;
                show_on_menu: boolean | null;
            },
        ])
    );
    const embById = new Map(
        embRows.map((r) => [
            String((r as { id: string }).id),
            r as { id: string; preco_venda: number | string; produto_id: string },
        ])
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
        const unitPrice = Number(row.preco_venda);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
            return { ok: false, error: "items_unavailable" };
        }
        orderItems.push({
            product_name: product.name,
            produto_embalagem_id: id,
            quantity: qty,
            unit_price: unitPrice,
        });
        subtotal += unitPrice * qty;
    }

    // Endereço
    let deliveryEnderecoClienteId: string | null = null;
    let addressText = "";
    let bairro = "";
    let cidade = "";
    let estado = "";

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
        cidade = found.cidade;
        estado = found.estado;
        addressText = formatDeliveryAddressText(found);
    } else {
        const a = params.input.newAddress;
        if (!a) return { ok: false, error: "address_required" };
        const logradouro = String(a.logradouro ?? "").trim();
        const numero = String(a.numero ?? "").trim();
        bairro = String(a.bairro ?? "").trim();
        cidade = String(a.cidade ?? "").trim();
        estado = String(a.estado ?? "").trim().toUpperCase().slice(0, 2);
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

    const deliveryFee = delivery.fee;
    const grandTotal = subtotal + deliveryFee;

    if (delivery.min_order != null && grandTotal + 1e-9 < delivery.min_order) {
        return {
            ok: false,
            error: "min_order_not_met",
            message: `Pedido mínimo: R$ ${delivery.min_order.toFixed(2).replace(".", ",")}`,
            minOrder: delivery.min_order,
            grandTotal,
        };
    }

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
    });

    if (orderErr || !orderId) {
        console.error("[public-menu] create_order_with_items:", orderErr?.message);
        return { ok: false, error: "order_failed" };
    }

    const code = `#${String(orderId).replaceAll("-", "").slice(-6).toUpperCase()}`;
    return {
        ok: true,
        orderId: String(orderId),
        orderCode: code,
        requireApproval,
        subtotal,
        deliveryFee,
        grandTotal,
        deliveryAddress: addressText,
        etaMin: delivery.eta_min,
    };
}
