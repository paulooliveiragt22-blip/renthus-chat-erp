/**
 * Idempotência webhook Pagar.me — lifecycle (E1 híbrido).
 * Retorna true se deve processar; false se skip (completed / failed_permanent / processing fresco).
 */

import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { createAdminClient } from "@/lib/supabase/admin";
import { webhookConsumeKey } from "@/lib/billing/webhookIdempotencyKey";

type Admin = ReturnType<typeof createAdminClient>;

export type WebhookEventStatus =
    | "processing"
    | "completed"
    | "failed_retryable"
    | "failed_permanent";

const STALE_PROCESSING_MS = 10 * 60 * 1000;

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
        status: "processing",
        updated_at: new Date().toISOString(),
    });

    if (!error) return true;

    const dup =
        error.code === "23505" ||
        (typeof error.message === "string" && error.message.toLowerCase().includes("duplicate key"));
    if (!dup) {
        console.error("[billing:webhook] pagarme_webhook_events insert:", error.message);
        throw new Error(error.message);
    }

    const { data: row, error: selErr } = await admin
        .from("pagarme_webhook_events")
        .select("status, updated_at")
        .eq("id", id)
        .maybeSingle();

    if (selErr) throw new Error(selErr.message);

    const status = (row?.status as WebhookEventStatus | undefined) ?? "completed";
    if (status === "completed" || status === "failed_permanent") {
        return false;
    }

    const updatedAt = row?.updated_at ? new Date(row.updated_at).getTime() : 0;
    const stale =
        status === "failed_retryable" ||
        (status === "processing" && Date.now() - updatedAt > STALE_PROCESSING_MS);

    if (!stale) {
        return false;
    }

    const { error: upErr } = await admin
        .from("pagarme_webhook_events")
        .update({
            status: "processing",
            updated_at: new Date().toISOString(),
            last_error: null,
        })
        .eq("id", id)
        .in("status", ["failed_retryable", "processing"]);

    if (upErr) throw new Error(upErr.message);
    return true;
}

export async function markWebhookEventCompleted(admin: Admin, eventKey: string): Promise<void> {
    await admin
        .from("pagarme_webhook_events")
        .update({
            status: "completed",
            updated_at: new Date().toISOString(),
            last_error: null,
        })
        .eq("id", eventKey);
}

export async function markWebhookEventRetryable(
    admin: Admin,
    eventKey: string,
    errMsg: string
): Promise<void> {
    await admin
        .from("pagarme_webhook_events")
        .update({
            status: "failed_retryable",
            updated_at: new Date().toISOString(),
            last_error: errMsg.slice(0, 2000),
        })
        .eq("id", eventKey);
}

export async function markWebhookEventPermanent(
    admin: Admin,
    eventKey: string,
    errMsg: string,
    detail?: {
        event_type?: string;
        order_id?: string | null;
        extra?: Record<string, unknown>;
    }
): Promise<void> {
    await admin
        .from("pagarme_webhook_events")
        .update({
            status: "failed_permanent",
            updated_at: new Date().toISOString(),
            last_error: errMsg.slice(0, 2000),
        })
        .eq("id", eventKey);

    await admin.from("billing_fulfill_failures").insert({
        event_key: eventKey,
        event_type: detail?.event_type ?? null,
        order_id: detail?.order_id ?? null,
        error: errMsg.slice(0, 4000),
        detail: detail?.extra ?? null,
    });

    Sentry.captureMessage("billing_fulfill_failed", {
        level: "error",
        tags: {
            route: "billing-webhook",
            kind: "fulfill_failed_permanent",
            event_type: detail?.event_type ?? "unknown",
        },
        extra: {
            event_key: eventKey,
            order_id: detail?.order_id ?? null,
            error: errMsg.slice(0, 500),
        },
    });
}
