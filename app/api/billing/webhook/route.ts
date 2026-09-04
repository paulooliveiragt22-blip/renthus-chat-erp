/**
 * POST /api/billing/webhook
 *
 * Pagar.me Core v5: o webhook é **notificação**, não fonte da verdade.
 * Em `order.paid` / `charge.paid` → GET `/orders/:id` na API → só então `FulfillPayment`.
 *
 * Auth L1: Basic Auth do hookset (`PAGARME_WEBHOOK_BASIC_USER` /
 * `PAGARME_WEBHOOK_BASIC_PASSWORD`) — obrigatório em produção.
 * HMAC `PAGARME_WEBHOOK_SECRET` = legado (só se `X-Hub-Signature` vier).
 *
 * Política E1: transitório → 500 + failed_retryable; permanente → 200 + dead-letter
 */

import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import {
    getPagarmeOrder,
    isPagarmeOrderPaid,
} from "@/lib/billing/pagarme";
import { assertPagarmeWebhookAuth } from "@/lib/billing/pagarmeWebhookAuth";
import { billingLog } from "@/lib/billing/billingLog";
import {
    tryConsumePagarmeWebhookEvent,
    markWebhookEventCompleted,
    markWebhookEventRetryable,
    markWebhookEventPermanent,
} from "@/lib/billing/tryConsumePagarmeWebhookEvent";
import { extractWebhookOrderId, webhookConsumeKey } from "@/lib/billing/webhookIdempotencyKey";
import {
    fulfillPayment,
    isPermanentFulfillError,
    RetryableFulfillError,
    PermanentFulfillError,
} from "@/lib/billing/fulfillPayment";
import {
    enforceIpRateLimitAsync,
    RATE_LIMIT_WINDOW_MS,
} from "@/lib/security/rateLimit";

export const runtime = "nodejs";

const BILLING_WEBHOOK_RL_LIMIT = 120;

export async function POST(req: Request) {
    const limited = await enforceIpRateLimitAsync(
        req,
        "billing_webhook",
        BILLING_WEBHOOK_RL_LIMIT,
        RATE_LIMIT_WINDOW_MS,
        { error: "rate_limited" }
    );
    if (limited) return limited;

    const rawBody = await req.text();
    const auth = assertPagarmeWebhookAuth({
        authorization: req.headers.get("authorization"),
        signatureHeader: req.headers.get("x-hub-signature"),
        rawBody,
    });
    if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    let event: Record<string, unknown>;
    try {
        event = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const eventType: string = typeof event?.type === "string" ? event.type : "";
    const data = (event?.data ?? {}) as Record<string, unknown>;
    const eventId = typeof event?.id === "string" ? event.id : undefined;
    const orderIdForIdem = extractWebhookOrderId(eventType, data);
    const eventKey = webhookConsumeKey(eventId, eventType, orderIdForIdem);

    billingLog("webhook", "received", {
        event_type: eventType,
        event_id: eventId,
        order_id: orderIdForIdem ?? (data as { id?: string })?.id,
    });

    const admin = createAdminClient();

    try {
        const proceed = await tryConsumePagarmeWebhookEvent(
            admin,
            eventId,
            eventType,
            orderIdForIdem
        );
        if (!proceed) {
            billingLog("webhook", "duplicate_event_skipped", {
                event_id: eventId,
                event_type: eventType,
                order_id: orderIdForIdem,
            });
            return NextResponse.json({ ok: true, duplicate: true });
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[webhook/pagarme] idempotency:", msg);
        return NextResponse.json({ error: "idempotency_store_failed", detail: msg }, { status: 500 });
    }

    try {
        switch (eventType) {
            case "order.paid":
                await handleOrderPaid(admin, data);
                break;

            case "charge.paid": {
                const ord = (data?.order ?? {}) as {
                    id?: string;
                    metadata?: Record<string, string>;
                    customer?: unknown;
                };
                const oid =
                    typeof ord?.id === "string" && ord.id
                        ? ord.id
                        : (data?.order_id as string | undefined);
                if (oid) {
                    await handleOrderPaid(admin, {
                        id: oid,
                        metadata: (ord?.metadata ??
                            (data?.metadata as Record<string, string> | undefined) ??
                            {}) as Record<string, string>,
                        customer: (data?.customer ?? ord.customer) as { id?: string } | undefined,
                    });
                } else {
                    throw new PermanentFulfillError("charge.paid sem id do pedido");
                }
                break;
            }

            case "order.payment_failed":
            case "charge.failed":
                await handleOrderFailed(admin, data);
                break;

            default:
                billingLog("webhook", "event_type_ignored", { event_type: eventType });
        }

        if (eventKey) {
            await markWebhookEventCompleted(admin, eventKey);
        }
        return NextResponse.json({ ok: true });
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[webhook/pagarme] handler_error:", msg);

        const permanent =
            isPermanentFulfillError(err) ||
            /sem (order\.id|setup_payments|invoice|ai_pack)|metadata\.(type|inválida)|não tratado/i.test(
                msg
            );

        if (eventKey) {
            if (permanent) {
                await markWebhookEventPermanent(admin, eventKey, msg, {
                    event_type: eventType,
                    order_id: orderIdForIdem,
                });
                Sentry.captureException(err, {
                    tags: { route: "billing-webhook", kind: "permanent" },
                });
                return NextResponse.json({ ok: false, error: msg, permanent: true });
            }
            await markWebhookEventRetryable(admin, eventKey, msg);
        }

        Sentry.captureException(err, {
            tags: { route: "billing-webhook", kind: "retryable" },
        });
        // 500 → Pagar.me retenta (E1)
        return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
}

/**
 * Notificação → confirma paid na API → FulfillPayment (mesmo núcleo do sync).
 */
async function handleOrderPaid(
    admin: ReturnType<typeof createAdminClient>,
    orderHint: Record<string, unknown>
) {
    const orderId = typeof orderHint.id === "string" ? orderHint.id.trim() : "";
    if (!orderId) {
        throw new PermanentFulfillError("order.paid sem order.id");
    }

    let apiOrder;
    try {
        apiOrder = await getPagarmeOrder(orderId);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new RetryableFulfillError(`GET order PSP falhou: ${msg}`);
    }

    if (!isPagarmeOrderPaid(apiOrder)) {
        billingLog("webhook", "psp_not_paid_yet", {
            order_id: orderId,
            status: apiOrder.status,
            charge_status: apiOrder.charges?.[0]?.status,
        });
        throw new RetryableFulfillError(
            `order ${orderId} ainda não paid na API (status=${apiOrder.status})`
        );
    }

    const result = await fulfillPayment(admin, {
        id: apiOrder.id,
        metadata: {
            ...((orderHint.metadata as Record<string, string> | undefined) ?? {}),
            ...((apiOrder.metadata as Record<string, string> | undefined) ?? {}),
        },
        customer: apiOrder.customer ?? (orderHint.customer as { id?: string } | undefined),
    });
    billingLog("webhook", "fulfill_ok", {
        order_id: apiOrder.id,
        kind: result.kind,
        already_done: result.alreadyDone ?? false,
        source: "api_confirmed",
    });
}

async function handleOrderFailed(
    admin: ReturnType<typeof createAdminClient>,
    order: Record<string, unknown>
) {
    const orderId = order?.id as string;
    if (!orderId) return;

    await admin
        .from("invoices")
        .update({ status: "failed" })
        .eq("pagarme_order_id", orderId)
        .eq("status", "pending");

    await admin
        .from("setup_payments")
        .update({ status: "failed" })
        .eq("pagarme_order_id", orderId)
        .eq("status", "pending");

    billingLog("webhook", "payment_failed", { order_id: orderId });
}
