/**
 * Chave de idempotência do webhook Pagar.me (puro — testável).
 * Preferência: event.id; fallback: eventType:orderId.
 */

export function webhookConsumeKey(
    eventId: string | null | undefined,
    eventType: string,
    orderId: string | null | undefined
): string | null {
    const eid = eventId?.trim();
    if (eid) return eid;

    const oid = orderId?.trim();
    const et = eventType?.trim();
    if (oid && et) return `${et}:${oid}`;

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
