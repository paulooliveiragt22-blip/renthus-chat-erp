import { createHash } from "node:crypto";

/**
 * Chave de idempotência.
 *
 * Preferir `attemptId` (UUID gerado no cliente por tentativa de checkout):
 * - double-click / retry de rede → mesma chave → 1 pedido
 * - novo pedido com o mesmo carrinho → attemptId novo → pedido novo
 *
 * Sem `attemptId`, cai no hash de conteúdo (legado Flow / clientes antigos).
 * Esse fallback colide se o mesmo cliente repetir o carrinho idêntico de propósito.
 */
export function buildOrderIdempotencyKey(parts: {
    source: string;
    scopeId: string;
    items: Array<{ produtoEmbalagemId?: string | null; quantity: number; unitPrice: number }>;
    grandTotal: number;
    paymentMethod?: string | null;
    /** UUID (ou hex 64) da tentativa — canônico no cardápio web. */
    attemptId?: string | null;
}): string {
    const attempt = String(parts.attemptId ?? "").trim();
    if (isValidOrderIdempotencyKey(attempt)) {
        const raw = [parts.source, parts.scopeId, attempt].join("::");
        return createHash("sha256").update(raw).digest("hex");
    }

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

/** UUID v4 ou sha256 hex (64). */
export function isValidOrderIdempotencyKey(raw: unknown): boolean {
    const s = String(raw ?? "").trim();
    if (/^[0-9a-f]{64}$/i.test(s)) return true;
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        s
    );
}

