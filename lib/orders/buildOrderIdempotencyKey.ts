import { createHash } from "node:crypto";

/**
 * Chave de idempotência determinística pra rotas que não têm uma chave natural
 * do cliente (web menu, WhatsApp Flow). Duas chamadas com o mesmo conteúdo
 * (mesmo carrinho/total/pagamento, mesmo escopo) produzem a mesma chave — retry
 * de rede ou double-click não duplica o pedido. Pedido novo com conteúdo
 * idêntico ao anterior dentro do mesmo escopo é o único caso que colide de
 * propósito (aceitável: cliente pode variar 1 item pra reforçar intenção).
 */
export function buildOrderIdempotencyKey(parts: {
    source: string;
    scopeId: string;
    items: Array<{ produtoEmbalagemId?: string | null; quantity: number; unitPrice: number }>;
    grandTotal: number;
    paymentMethod?: string | null;
}): string {
    const stableItems = parts.items
        .map((i) => `${i.produtoEmbalagemId ?? ""}:${i.quantity}:${i.unitPrice}`)
        .sort()
        .join("|");
    const raw = [
        parts.source,
        parts.scopeId,
        stableItems,
        parts.grandTotal,
        parts.paymentMethod ?? "",
    ].join("::");
    return createHash("sha256").update(raw).digest("hex");
}
