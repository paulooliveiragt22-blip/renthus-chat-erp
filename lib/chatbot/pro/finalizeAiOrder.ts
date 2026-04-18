import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiOrderCanonicalDraft } from "./typesAiOrder";
import type { CartItem } from "../types";
import type { OrderServiceResult } from "@/src/types/contracts.legacy";
import { getOrCreateCustomer } from "../db/orders";
import { formatCart, formatCurrency } from "../utils";
import { loadPackRowForValidation } from "./prepareOrderDraft";

export async function revalidateDraftAgainstDb(
    admin: SupabaseClient,
    companyId: string,
    draft: AiOrderCanonicalDraft
): Promise<{ ok: true } | { ok: false; message: string }> {
    for (const it of draft.items) {
        const loaded = await loadPackRowForValidation(admin, companyId, it.produto_embalagem_id);
        if (!loaded) {
            return { ok: false, message: "Um produto deixou de estar disponível. Ajuste o pedido no chat, por favor." };
        }
        const priceOk = Math.abs(loaded.row.preco_venda - it.unit_price) < 0.02;
        if (!priceOk) {
            return { ok: false, message: "O preço de um item mudou. Peça um novo resumo no chat, por favor." };
        }
        const need = it.quantity * loaded.row.fator_conversao;
        if (loaded.estoque < need) {
            return { ok: false, message: `Estoque insuficiente para "${it.product_name}".` };
        }
    }
    const ufOk = draft.address?.estado && String(draft.address.estado).trim().length >= 2;
    if (
        !draft.address?.logradouro ||
        !draft.address?.numero ||
        !draft.address?.bairro ||
        !draft.address?.cidade?.trim() ||
        !ufOk
    ) {
        return { ok: false, message: "Endereço incompleto." };
    }
    return { ok: true };
}

function draftToCartItems(draft: AiOrderCanonicalDraft): CartItem[] {
    return draft.items.map((i) => ({
        variantId: i.produto_embalagem_id,
        productId: "",
        name:      i.product_name,
        price:     i.unit_price,
        qty:       i.quantity,
    }));
}

export async function tryFinalizeAiOrderFromDraft(params: {
    admin:         SupabaseClient;
    companyId:     string;
    phoneE164:     string;
    profileName?: string | null;
    draft:         AiOrderCanonicalDraft;
}): Promise<OrderServiceResult> {
    const { admin, companyId, phoneE164, profileName, draft } = params;

    const fresh = await revalidateDraftAgainstDb(admin, companyId, draft);
    if (!fresh.ok) return { ok: false, customerMessage: fresh.message };

    const customer = await getOrCreateCustomer(admin, companyId, phoneE164, profileName ?? null);
    if (!customer?.id) {
        return { ok: false, customerMessage: "Não consegui cadastrar o cliente. Tente de novo daqui a pouco." };
    }

    if (!draft.address) {
        return { ok: false, customerMessage: "Morada em falta." };
    }
    const addr = draft.address;
    const apelido = addr.apelido?.trim() || "WhatsApp";

    const payload: Record<string, unknown> = {
        address_id:    addr.endereco_cliente_id ?? null,
        apelido,
        logradouro:    addr.logradouro,
        numero:        addr.numero,
        complemento: addr.complemento ?? "",
        bairro:        addr.bairro,
        cidade:        addr.cidade ?? "",
        estado:        addr.estado ?? "",
        cep:           addr.cep ?? "",
        is_principal:  true,
    };

    const { data: deliveryEnderecoClienteId, error: addrErr } = await admin.rpc(
        "rpc_chatbot_pro_upsert_endereco_cliente",
        {
            p_company_id:  companyId,
            p_customer_id: customer.id,
            p_payload:     payload,
        }
    );

    if (addrErr || !deliveryEnderecoClienteId) {
        console.error("[chatbot/pro] rpc_chatbot_pro_upsert_endereco_cliente:", addrErr?.message);
        return {
            ok: false,
            customerMessage:
                "Não consegui salvar o endereço. Confira rua, número, bairro, cidade e UF e tente de novo. 😊",
        };
    }

    const { data: settings } = await admin
        .from("company_settings")
        .select("require_order_approval")
        .eq("company_id", companyId)
        .maybeSingle();

    const requireApproval    = settings?.require_order_approval ?? false;
    const confirmationStatus = requireApproval ? "pending_confirmation" : "confirmed";

    const addressText = draft.delivery_address_text
        ?? [
            addr.logradouro,
            addr.numero,
            addr.complemento,
            addr.bairro_label ?? addr.bairro,
            addr.cidade,
            addr.estado,
            addr.cep,
        ].filter(Boolean).join(", ");

    const cartPayload = draft.items.map((item) => ({
        product_name:         item.product_name,
        produto_embalagem_id: item.produto_embalagem_id,
        quantity:             item.quantity,
        unit_price:           item.unit_price,
    }));

    const { data: orderId, error: orderErr } = await admin.rpc("create_order_with_items", {
        p_company_id:                   companyId,
        p_customer_id:                  customer.id,
        p_status:                       "new",
        p_confirmation_status:          confirmationStatus,
        p_source:                       "chatbot",
        p_channel:                      "whatsapp",
        p_total_amount:                 draft.grand_total,
        p_total:                        draft.total_items,
        p_delivery_fee:                 draft.delivery_fee,
        p_delivery_address:             addressText,
        p_delivery_endereco_cliente_id: deliveryEnderecoClienteId,
        p_payment_method:               draft.payment_method,
        p_change_for:                   draft.change_for ?? null,
        p_paid:                         false,
        p_items:                        cartPayload,
    });

    if (orderErr || !orderId) {
        console.error("[chatbot/pro] create_order_with_items:", orderErr?.message);
        return { ok: false, customerMessage: "Não consegui salvar o pedido. Tente de novo ou use o catálogo. 😊" };
    }

    const cartLike = draftToCartItems(draft);
    const feeText  = draft.delivery_fee > 0
        ? `\n🛵 Taxa de entrega: ${formatCurrency(draft.delivery_fee)}`
        : "";
    const minOrderText = draft.delivery_min_order != null
        ? `\n📌 Pedido mínimo da região: ${formatCurrency(draft.delivery_min_order)}`
        : "";
    const etaText = draft.delivery_eta_min != null
        ? `\n⏱️ Previsão: ${Math.max(0, Math.floor(draft.delivery_eta_min))} min`
        : "";
    const chgText  = draft.change_for ? ` (troco para ${formatCurrency(draft.change_for)})` : "";
    let pmLabel = "Dinheiro";
    if (draft.payment_method === "pix") pmLabel = "PIX";
    else if (draft.payment_method === "card") pmLabel = "Cartão";

    const orderCode = `#${String(orderId).replaceAll("-", "").slice(-6).toUpperCase()}`;

    const customerMessage = requireApproval
        ? `✅ *Pedido recebido!*\n\nPedido ${orderCode}\nTotal: ${formatCurrency(draft.grand_total)}\n\nEstamos confirmando — já voltamos com você! 🍺`
        : `✅ *Pedido confirmado!*\n\nPedido ${orderCode}\n\n${formatCart(cartLike)}${feeText}${minOrderText}${etaText}\n📍 ${addressText}\n💳 ${pmLabel}${chgText}\n\nObrigado! 🍺`;

    return {
        ok:              true,
        orderId:         orderId as string,
        customerMessage,
        requireApproval,
    };
}
