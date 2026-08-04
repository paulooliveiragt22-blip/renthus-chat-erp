/** Rótulos de status de pedido para o cardápio web (PT-BR). */
export function publicMenuOrderStatusLabel(
    status: string,
    confirmationStatus: string | null | undefined
): string {
    const st = String(status ?? "").toLowerCase();
    const conf = String(confirmationStatus ?? "").toLowerCase();

    if (st === "canceled" || st === "cancelled") return "Cancelado";
    if (conf === "pending_confirmation") return "Aguardando confirmação";
    if (st === "finalized") return "Finalizado";
    if (st === "delivered") return "Em entrega";
    if (st === "preparing" || st === "in_preparation") return "Em preparo";
    if (st === "ready") return "Pronto";
    if (st === "new" || st === "received" || conf === "confirmed") return "Recebido";
    return "Em andamento";
}

export function publicMenuPaymentLabel(method: string | null | undefined): string {
    const m = String(method ?? "").toLowerCase();
    if (m === "pix") return "PIX";
    if (m === "card") return "Cartão";
    if (m === "cash") return "Dinheiro";
    return method?.trim() || "—";
}

export function publicMenuOrderCode(orderId: string): string {
    return `#${String(orderId).replaceAll("-", "").slice(-6).toUpperCase()}`;
}
