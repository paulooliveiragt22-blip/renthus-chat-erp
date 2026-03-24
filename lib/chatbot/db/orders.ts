/**
 * lib/chatbot/db/orders.ts
 *
 * Funções de criação de pedidos e gestão de clientes no Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CartItem, Customer } from "../types";
import { cartTotal } from "../utils";
import { botReply } from "../botSend";

// ─── Envio (local helper) ─────────────────────────────────────────────────────

async function reply(admin: SupabaseClient, companyId: string, threadId: string, phoneE164: string, text: string): Promise<void> {
    await botReply(admin, companyId, threadId, phoneE164, text);
}

// ─── Cliente ──────────────────────────────────────────────────────────────────

export async function getOrCreateCustomer(
    admin: SupabaseClient,
    companyId: string,
    phoneE164: string,
    name?: string | null
): Promise<Customer | null> {
    const phoneClean = phoneE164.replace(/\D/g, "");

    const { data: existing } = await admin
        .from("customers")
        .select("id, name, phone, address, is_adult")
        .eq("company_id", companyId)
        .or(`phone.eq.${phoneE164},phone.eq.${phoneClean}`)
        .limit(1)
        .maybeSingle();

    if (existing) return existing as Customer;

    const { data: created, error } = await admin
        .from("customers")
        .insert({ company_id: companyId, name: name ?? "Cliente WhatsApp", phone: phoneE164 })
        .select("id, name, phone, address, is_adult")
        .single();

    if (error) {
        console.error("[chatbot] Erro ao criar customer:", error.message, "| company:", companyId, "| phone:", phoneE164);
        return null;
    }

    return created as Customer;
}

// ─── Pedido ───────────────────────────────────────────────────────────────────

/**
 * payment_method aceita: "pix" | "cash" | "card"
 * delivery_address é coluna real em orders.
 * details é reservado para observações do dashboard (ex: "recolher cascos").
 */
export async function createOrder(
    admin: SupabaseClient,
    companyId: string,
    customerId: string,
    cart: CartItem[],
    paymentMethod: string,
    deliveryAddress: string,
    changeFor?: number | null,
    deliveryFee = 0
): Promise<string> {
    const total = cartTotal(cart) + deliveryFee;

    const orderPayload = {
        company_id:          companyId,
        customer_id:         customerId,
        status:              "new",
        confirmation_status: "pending_confirmation",
        channel:             "whatsapp",
        payment_method:      paymentMethod,
        paid:                false,
        delivery_fee:        deliveryFee,
        total:               total,
        total_amount:        total,
        change_for:          changeFor ?? null,
        delivery_address:    deliveryAddress,
        // details: reservado para observações do dashboard — não poluir com dados do pedido
    };

    const { data: order, error: orderErr } = await admin
        .from("orders")
        .insert(orderPayload)
        .select()
        .single();

    if (orderErr || !order?.id) {
        console.error("[createOrder] FALHA ao inserir order:", {
            code:    orderErr?.code,
            message: orderErr?.message,
            details: orderErr?.details,
            hint:    orderErr?.hint,
        });
        throw new Error(orderErr?.message ?? "Falha ao criar pedido");
    }

    const items = cart.map((item) => ({
        order_id:           order.id,
        company_id:         companyId,
        product_id:         item.productId,
        produto_embalagem_id: item.variantId,
        product_name:       item.name,
        quantity:           item.qty,
        qty:                item.qty,
        unit_price:         item.price,
        unit_type:          item.isCase ? "case" : "unit",
        // line_total é coluna gerada no banco; não deve ser enviada
    }));

    const { error: itemsErr } = await admin.from("order_items").insert(items);

    if (itemsErr) {
        console.error("[createOrder] FALHA ao inserir itens:", {
            code:    itemsErr.code,
            message: itemsErr.message,
            details: itemsErr.details,
            hint:    itemsErr.hint,
            items,
        });
        throw new Error(itemsErr.message ?? "Falha ao criar itens do pedido");
    }

    // Débito de estoque fica a cargo do trigger em `order_items` (produto_embalagem_id → fator_conversao).

    return order.id as string;
}

// ─── Status do pedido ─────────────────────────────────────────────────────────

/** Consulta o último pedido e responde com status — reutilizado em Layer 1 e no fallback do Claude */
export async function replyWithOrderStatus(
    admin: SupabaseClient,
    companyId: string,
    threadId: string,
    phoneE164: string
): Promise<void> {
    const { data: recentOrder } = await admin
        .from("orders")
        .select("id, status, total_amount, created_at")
        .eq("company_id", companyId)
        .eq("customer_phone", phoneE164)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (recentOrder) {
        const statusMap: Record<string, string> = {
            new:       "📦 Em preparo",
            delivered: "🚴 A caminho",
            finalized: "✅ Entregue",
            canceled:  "❌ Cancelado",
        };
        const statusText = statusMap[recentOrder.status] ?? recentOrder.status;
        const total = Number(recentOrder.total_amount ?? 0)
            .toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
        await reply(
            admin, companyId, threadId,
            phoneE164,
            `Seu último pedido:\n\n🧾 Status: *${statusText}*\n💰 Total: *${total}*\n\nPrecisa de mais alguma coisa?`
        );
    } else {
        await reply(admin, companyId, threadId, phoneE164, "Não encontrei pedidos recentes para o seu número. Posso te ajudar a fazer um novo pedido! 🛒");
    }
}
