/**
 * Chave de idempotência do webhook Pagar.me (puro — testável).
 * Preferência: event.id; fallback estável por order: `pge:{orderId}`
 * (evita duplicar fulfill entre `order.paid` e `charge.paid` sem event.id).
 */

export function webhookConsumeKey(
    eventId: string | null | undefined,
    eventType: string,
    orderId: string | null | undefined
): string | null {
    const eid = eventId?.trim();
    if (eid) return eid;

    const oid = orderId?.trim();
    if (oid) return `pge:${oid}`;

    void eventType;
    return null;
}

/** Extrai order id de payloads order.* / charge.* comuns do Pagar.me. */
export function extractWebhookOrderId(eventType: string, data: unknown): string | null {
    if (!data || typeof data !== "object") return null;
    const d = data as Record<string, unknown>;

    if (typeof d.id === "string" && d.id && eventType.startsWith("order.")) {
        return d.id;
    }

    const order = d.order;
    if (order && typeof order === "object") {
        const oid = (order as { id?: unknown }).id;
        if (typeof oid === "string" && oid) return oid;
    }

    if (typeof d.order_id === "string" && d.order_id) return d.order_id;

    if (typeof d.id === "string" && d.id) return d.id;

    return null;
}
