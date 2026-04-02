/**
 * Retorna true se o evento deve ser processado; false se já foi visto (id duplicado).
 * Sem id no payload, retorna true (compatível com payloads antigos).
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

type Admin = ReturnType<typeof createAdminClient>;

export async function tryConsumePagarmeWebhookEvent(
    admin: Admin,
    eventId: string | null | undefined,
    eventType: string
): Promise<boolean> {
    const id = eventId?.trim();
    if (!id) return true;

    const { error } = await admin.from("pagarme_webhook_events").insert({
        id:         id,
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
