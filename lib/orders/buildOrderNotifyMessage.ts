import { formatDeliveryEtaConfirmLine } from "@/lib/delivery/policy";

function moneyBr(n: number): string {
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function paymentLabel(m: string): string {
    return ({ pix: "PIX", card: "Cartão", cash: "Dinheiro", debit: "Débito" } as Record<
        string,
        string
    >)[m] ?? m;
}

export type WebMenuOrderNotifyInput = {
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
    notes?: string | null;
};

export function buildWebMenuOrderNotifyMessage(params: WebMenuOrderNotifyInput): string {
    const {
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
        notes,
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
    const notesLine = notes?.trim() ? `\n📝 Obs.: ${notes.trim()}` : "";

    return requireApproval
        ? `✅ *Pedido Recebido!*\n\nPedido ${orderCode}\nTotal: ${moneyBr(grandTotal)}${notesLine}\n\nEstamos confirmando seu pedido. Você receberá retorno em instantes! 🍺`
        : `✅ *Pedido Confirmado!*\n\nPedido ${orderCode}\n\n${itemsBlock}${feeText}\n${placeLine}\n💳 ${paymentLabel(paymentMethod)}${chgText}${etaBlock}${notesLine}\n\nObrigado pela preferência! 🍺`;
}

export function buildFilaOrderConfirmedMessage(params: {
    orderCode: string;
    grandTotal: number;
    fulfillmentType?: string | null;
    etaMin?: number | null;
}): string {
    const total = params.grandTotal.toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
    });
    const isPickup = params.fulfillmentType === "pickup";
    const modeLine = isPickup ? `🏪 *Retirada no local*\n\n` : "";
    const etaLine =
        !isPickup &&
        params.etaMin != null &&
        Number.isFinite(params.etaMin)
            ? `🚚 *Previsão de entrega:* ${Math.max(0, Math.floor(params.etaMin))} minutos\n\n`
            : "";

    return (
        `✅ *Pedido Confirmado!*\n\n` +
        `Pedido ${params.orderCode}\n` +
        `Total: ${total}\n\n` +
        modeLine +
        etaLine +
        `Obrigado pela preferência! 🍺`
    );
}
