/**
 * Retorna true se o evento deve ser processado; false se já foi visto.
 * Chave: event.id OU `${eventType}:${orderId}` (P0.5).
 * Sem chave estável → false (não processa — evita side effects não idempotentes).
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { webhookConsumeKey } from "@/lib/billing/webhookIdempotencyKey";

type Admin = ReturnType<typeof createAdminClient>;

export async function tryConsumePagarmeWebhookEvent(
    admin: Admin,
    eventId: string | null | undefined,
    eventType: string,
    orderId?: string | null
): Promise<boolean> {
    const id = webhookConsumeKey(eventId, eventType, orderId);
    if (!id) {
        console.warn(
            "[billing:webhook] sem chave de idempotência (event.id / order.id) — skip",
            { eventType }
        );
        return false;
    }

    const { error } = await admin.from("pagarme_webhook_events").insert({
        id,
        event_type: eventType,
    });

    if (!error) return true;

    const dup =
        error.code === "23505" ||
        (typeof error.message === "string" && error.message.toLowerCase().includes("duplicate key"));
    if (dup) return false;

    console.error("[billing:webhook] pagarme_webhook_events insert:", error.message);
    throw new Error(error.message);
}
