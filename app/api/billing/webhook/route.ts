/**
 * POST /api/billing/webhook
 *
 * Webhook do Pagar.me — recebe eventos de pagamento.
 *
 * Eventos tratados:
 *   order.paid          → se setup_payment: ativa trial
 *                       → se invoice:       marca paga + ativa/reativa subscription
 *   order.payment_failed → registra falha
 *
 * Variáveis de ambiente:
 *   PAGARME_WEBHOOK_SECRET — segredo configurado no painel Pagar.me (opcional em dev)
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature, extractOrderCustomerId, type PagarmeOrder } from "@/lib/billing/pagarme";
import { processSetupOrderPaid } from "@/lib/billing/pagarmeSetupPaid";
import { applyMonthlyInvoicePaid } from "@/lib/billing/applyMonthlyInvoicePaid";
import { creditAiPack } from "@/lib/billing/aiWallet";
import { billingLog } from "@/lib/billing/billingLog";
import { tryConsumePagarmeWebhookEvent } from "@/lib/billing/tryConsumePagarmeWebhookEvent";
import { extractWebhookOrderId } from "@/lib/billing/webhookIdempotencyKey";
import {
    enforceIpRateLimitAsync,
    RATE_LIMIT_WINDOW_MS,
} from "@/lib/security/rateLimit";

export const runtime = "nodejs";

const BILLING_WEBHOOK_RL_LIMIT = 120;

// Pagar.me não envia autenticação de rota — usa assinatura HMAC no body
export async function POST(req: Request) {
    const limited = await enforceIpRateLimitAsync(
        req,
        "billing_webhook",
        BILLING_WEBHOOK_RL_LIMIT,
        RATE_LIMIT_WINDOW_MS,
        { error: "rate_limited" }
    );
    if (limited) return limited;

    const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    if (isProd && !process.env.PAGARME_WEBHOOK_SECRET?.trim()) {
        console.error("[billing/webhook] PAGARME_WEBHOOK_SECRET obrigatório em produção");
        return NextResponse.json({ error: "server_misconfigured" }, { status: 500 });
    }

    const rawBody  = await req.text();
    const signature = (req as any).headers?.get?.("x-hub-signature") ?? "";

    // Verifica assinatura (ignora em dev se PAGARME_WEBHOOK_SECRET não estiver setado)
    const valid = await verifyWebhookSignature(rawBody, signature.replaceAll("sha256=", ""));
    if (!valid) {
        return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
    }

    let event: any;
    try {
        event = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }

    const eventType: string = event?.type ?? "";
    const data              = event?.data ?? {};
    const eventId           = typeof event?.id === "string" ? event.id : undefined;
    const orderIdForIdem    = extractWebhookOrderId(eventType, data);

    billingLog("webhook", "received", {
        event_type: eventType,
        event_id:   eventId,
        order_id:   orderIdForIdem ?? (data as { id?: string })?.id,
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
                event_id:   eventId,
                event_type: eventType,
                order_id:   orderIdForIdem,
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

            // Alguns ambientes enviam confirmação só em charge.* — o pedido vem em data.order
            case "charge.paid": {
                const d    = data as Record<string, unknown>;
                const ord  = (d?.order ?? {}) as { id?: string; metadata?: Record<string, string> };
                const oid  = (typeof ord?.id === "string" && ord.id) ? ord.id : (d?.order_id as string | undefined);
                if (oid) {
                    await handleOrderPaid(admin, {
                        id:       oid,
                        metadata: (ord?.metadata ?? d?.metadata ?? {}) as Record<string, string>,
                        customer: (d?.customer ?? (ord as { customer?: unknown }).customer) as unknown,
                    });
                } else {
                    console.warn("[webhook/pagarme] charge.paid sem id do pedido (order.id / order_id)");
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
    } catch (err: any) {
        console.error("[webhook/pagarme] handler_error:", err?.message ?? err);
        // Retorna 200 para o Pagar.me não fazer retry em erros de negócio
        return NextResponse.json({ ok: false, error: err?.message ?? "Erro interno" });
    }

    return NextResponse.json({ ok: true });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async function handleOrderPaid(
    admin: ReturnType<typeof createAdminClient>,
    order: any
) {
    const orderId = order?.id as string;
    if (!orderId) {
        console.warn("[webhook/pagarme] order.paid sem order.id");
        return;
    }

    const metadata = (order?.metadata ?? {}) as Record<string, string>;
    const metaType = metadata?.type as string | undefined;

    // ── 1) Setup: localizar SEMPRE por pagarme_order_id.
    if (await processSetupOrderPaid(admin, order)) {
        return;
    }

    if (metaType === "setup") {
        console.warn(
            "[webhook/pagarme] metadata.type=setup mas nenhuma linha em setup_payments para pagarme_order_id:",
            orderId
        );
        return;
    }

    // ── 1b) Pack de crédito IA
    if (metaType === "ai_pack") {
        const companyId = String(metadata.company_id ?? "");
        const packCents = Number(metadata.pack_cents);
        if (
            companyId &&
            (packCents === 1000 || packCents === 2000 || packCents === 5000)
        ) {
            const { data: recentCredits } = await admin
                .from("company_ai_ledger")
                .select("id, meta")
                .eq("company_id", companyId)
                .eq("kind", "pack_credit")
                .order("created_at", { ascending: false })
                .limit(30);
            const already = (recentCredits ?? []).some(
                (r) =>
                    r.meta &&
                    typeof r.meta === "object" &&
                    (r.meta as { pagarme_order_id?: string }).pagarme_order_id === orderId
            );
            if (!already) {
                await creditAiPack(admin, companyId, packCents as 1000 | 2000 | 5000, {
                    pagarme_order_id: orderId,
                    source: "pagarme_webhook",
                });
                billingLog("webhook", "ai_pack_credited", {
                    order_id: orderId,
                    company_id: companyId,
                    pack_cents: packCents,
                });
            } else {
                billingLog("webhook", "ai_pack_already_credited", { order_id: orderId });
            }
        } else {
            console.warn("[webhook/pagarme] ai_pack metadata inválida:", metadata);
        }
        return;
    }

    // ── 2) Invoice: metadata pode faltar — localiza por pagarme_order_id em invoices
    if (metaType === "invoice" || metaType === undefined) {
        const custId = extractOrderCustomerId(order as PagarmeOrder);
        const r = await applyMonthlyInvoicePaid(admin, orderId, { pagarmeCustomerId: custId });

        if (r.ok) {
            if (r.alreadyPaid) {
                billingLog("webhook", "invoice_already_paid_idempotent", { order_id: orderId });
            }
            return;
        }

        if (metaType === "invoice") {
            console.warn("[webhook/pagarme] metadata.type=invoice mas invoice não encontrada para order:", orderId);
        } else {
            console.warn(
                "[webhook/pagarme] order.paid sem setup_payment nem invoice para order:",
                orderId,
                "| metadata.type=",
                metaType ?? "(vazio)"
            );
        }
    } else if (metaType) {
        billingLog("webhook", "order_paid_unhandled_metadata_type", {
            order_id: orderId,
            meta_type: metaType,
        });
    }
}

async function handleOrderFailed(
    admin: ReturnType<typeof createAdminClient>,
    order: any
) {
    const orderId = order?.id as string;
    if (!orderId) return;

    // Atualiza invoice com status failed (se encontrada)
    await admin
        .from("invoices")
        .update({ status: "failed" })
        .eq("pagarme_order_id", orderId)
        .eq("status", "pending");

    // Atualiza setup_payment (se for setup)
    await admin
        .from("setup_payments")
        .update({ status: "failed" })
        .eq("pagarme_order_id", orderId)
        .eq("status", "pending");

    billingLog("webhook", "payment_failed", { order_id: orderId });
}

