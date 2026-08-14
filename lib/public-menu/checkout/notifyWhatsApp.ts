import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { formatDeliveryEtaConfirmLine } from "@/lib/delivery/policy";
import { sendWhatsAppMessage } from "@/lib/whatsapp/sendMessage";

function moneyBr(n: number): string {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function paymentLabel(m: string): string {
    return ({ pix: "PIX", card: "Cartão", cash: "Dinheiro" } as Record<string, string>)[m] ?? m;
}

/** Notifica o cliente no WhatsApp após checkout do cardápio web (não bloqueia o pedido). */
export async function notifyWebMenuOrderWhatsApp(params: {
    admin: SupabaseClient;
    companyId: string;
    phoneE164: string;
    orderCode: string;
    requireApproval: boolean;
    items: Array<{ product_name: string; quantity: number; unit_price: number }>;
    deliveryFee: number;
    grandTotal: number;
    deliveryAddress: string;
    paymentMethod: string;
    changeFor: number | null;
    etaMin: number | null;
    fulfillmentType?: "delivery" | "pickup";
}): Promise<void> {
    const {
        admin,
        companyId,
        phoneE164,
        orderCode,
        requireApproval,
        items,
        deliveryFee,
        grandTotal,
        deliveryAddress,
        paymentMethod,
        changeFor,
        etaMin,
        fulfillmentType,
    } = params;

    const itemsBlock = items
        .map((i) => `• ${i.quantity}x ${i.product_name} — ${moneyBr(i.unit_price * i.quantity)}`)
        .join("\n");
    const isPickup = fulfillmentType === "pickup";
    const feeText =
        isPickup ? "" : deliveryFee > 0 ? `\n🛵 Taxa de entrega: ${moneyBr(deliveryFee)}` : "";
    const placeLine = isPickup ? "🏪 Retirada no local" : `📍 ${deliveryAddress}`;
    const chgText =
        paymentMethod === "cash" && changeFor != null
            ? ` (troco para ${moneyBr(changeFor)})`
            : "";
    const etaLine = isPickup ? "" : formatDeliveryEtaConfirmLine(etaMin);
    const etaBlock = etaLine ? `\n\n${etaLine}` : "";

    const msg = requireApproval
        ? `✅ *Pedido Recebido!*\n\nPedido ${orderCode}\nTotal: ${moneyBr(grandTotal)}\n\nEstamos confirmando seu pedido. Você receberá retorno em instantes! 🍺`
        : `✅ *Pedido Confirmado!*\n\nPedido ${orderCode}\n\n${itemsBlock}${feeText}\n${placeLine}\n💳 ${paymentLabel(paymentMethod)}${chgText}${etaBlock}\n\nObrigado pela preferência! 🍺`;

    try {
        const result = await sendWhatsAppMessage({
            admin,
            companyId,
            toPhone: phoneE164,
            text: msg,
            senderType: "bot",
        });
        if (!result.ok) {
            console.warn("[public-menu] WhatsApp notify failed:", result.error);
        }
    } catch (err) {
        console.warn(
            "[public-menu] WhatsApp notify error:",
            err instanceof Error ? err.message : err
        );
    }
}
