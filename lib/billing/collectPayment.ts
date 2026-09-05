/**
 * CollectPayment — card-first na mesma obrigação (invoice), fallback PIX + EMV.
 * Usado pelo cron de renovação e retries D1/D3.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    createOrderWithSavedCard,
    createPixInvoiceOrder,
    isOrderCreditPaid,
    resolvePixFromOrder,
    type PagarmeOrder,
} from "@/lib/billing/pagarme";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";
import { fulfillPayment } from "@/lib/billing/fulfillPayment";
import { billingLog } from "@/lib/billing/billingLog";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";
import { sendBillingNotification, buildOverdueMessage } from "@/lib/billing/sendBillingNotification";
import { reconcileOrCancelLiveOrder } from "@/lib/billing/reconcileLivePagarmeOrder";
import { transitionBillingStatus } from "@/lib/billing/transitionBillingStatus";

type Admin = ReturnType<typeof createAdminClient>;

export type CollectPaymentKind = "subscription_renewal" | "subscription_first";

export type CollectCompany = {
    id?: string;
    name?: string | null;
    nome_fantasia?: string | null;
    email?: string | null;
    whatsapp_phone?: string | null;
    meta?: Record<string, unknown> | null;
    cnpj?: string | null;
};

export type CollectSub = {
    id: string;
    company_id: string;
    plan: string | null;
    pagarme_customer_id: string | null;
    default_card_id: string | null;
    last_paid_at?: string | null;
    updated_at?: string | null;
    seat_quantity?: number | null;
    companies?: CollectCompany | CollectCompany[] | null;
};

export type CollectPaymentResult =
    | { ok: true; outcome: "paid_card"; invoiceId: string; orderId: string }
    | { ok: true; outcome: "pix_pending"; invoiceId: string; orderId: string | null }
    | { ok: true; outcome: "skipped_existing"; invoiceId: string | null }
    | { ok: false; error: string };

function companyOf(sub: CollectSub): CollectCompany | null {
    const c = sub.companies;
    if (!c) return null;
    return Array.isArray(c) ? (c[0] ?? null) : c;
}

function customerPayload(sub: CollectSub, company: CollectCompany | null) {
    if (sub.pagarme_customer_id || !company) return undefined;
    return buildPagarmeCustomerPayload({
        id:             sub.company_id,
        name:           company.name ?? null,
        nome_fantasia:  company.nome_fantasia ?? null,
        email:          company.email ?? null,
        whatsapp_phone: company.whatsapp_phone ?? null,
        cnpj:           company.cnpj ?? null,
        meta:           company.meta ?? null,
    });
}

async function recordAttempt(
    admin: Admin,
    row: {
        company_id: string;
        invoice_id: string;
        kind: CollectPaymentKind;
        channel: "card" | "pix";
        pagarme_order_id: string | null;
        status: "paid" | "failed" | "pending";
        decline_code?: string | null;
        attempt_n: number;
        error_message?: string | null;
    }
) {
    const { error } = await admin.from("payment_attempts").insert(row);
    if (error && !isUniqueViolation(error)) {
        console.warn("[collectPayment] payment_attempts:", error.message);
    }
}

/**
 * Cria/recupera a obrigação (invoice) da mensalidade. O amount é CALCULADO no
 * banco por rpc_create_billing_obligation (ADR-0006 D9 / governanca Regra 2):
 * plano efetivo (pending downgrade incluso), seats, promo e período. O app não
 * envia valor — lê o amount_cents que o banco gravou.
 */
async function ensurePendingInvoice(
    admin: Admin,
    sub: CollectSub,
    _now: Date
): Promise<{
    id: string;
    amountCents: number;
    pagarme_order_id: string | null;
    pix_qr_code: string | null;
    created: boolean;
} | null> {
    const { data: rpc, error } = await admin.rpc("rpc_create_billing_obligation", {
        p_company_id: sub.company_id,
        p_kind: "subscription",
        p_seat_qty: null,
    });
    if (error) throw new Error(error.message);

    const result = (rpc ?? {}) as {
        invoice_id?: string;
        amount_cents?: number;
        status?: string;
    };
    const invoiceId = result.invoice_id;
    if (!invoiceId) return null;

    const amountCents = Number(result.amount_cents ?? 0);
    if (!Number.isFinite(amountCents) || amountCents <= 0) return null;

    const { data: row } = await admin
        .from("invoices")
        .select("pagarme_order_id, pix_qr_code")
        .eq("id", invoiceId)
        .maybeSingle();

    return {
        id: invoiceId,
        amountCents,
        pagarme_order_id: row?.pagarme_order_id ?? null,
        pix_qr_code: row?.pix_qr_code ?? null,
        created: result.status === "created",
    };
}

async function attachPixToInvoice(
    admin: Admin,
    sub: CollectSub,
    invoiceId: string,
    kind: CollectPaymentKind,
    attemptN: number,
    priorOrderId: string | null,
    amountCents: number
): Promise<
    | { orderId: string | null; pixUrl: string | null; pixCode: string | null; fulfilled?: false }
    | { fulfilled: true; orderId: string }
> {
    const recon = await reconcileOrCancelLiveOrder(admin, priorOrderId, "invoice");
    if (recon.action === "fulfilled") {
        return { fulfilled: true, orderId: priorOrderId ?? "" };
    }

    const company = companyOf(sub);
    const compLabel = (company?.nome_fantasia ?? company?.name ?? "").trim() || "Renthus";

    const created = await createPixInvoiceOrder({
        amountCents,
        description: `Mensalidade Renthus — Plano ${sub.plan}`,
        itemCode: "invoice",
        customerId: sub.pagarme_customer_id ?? undefined,
        customer: customerPayload(sub, company),
        additionalInfo: [
            { name: "Empresa", value: compLabel },
            { name: "Tipo", value: "Mensalidade" },
        ],
        metadata: {
            type: "invoice",
            company_id: sub.company_id,
            subscription_id: sub.id,
            plan: String(sub.plan ?? ""),
            invoice_id: invoiceId,
        },
    });

    const { order, pixUrl, pixCode } = await resolvePixFromOrder(created);

    await admin
        .from("invoices")
        .update({
            pagarme_order_id: order.id,
            pagarme_payment_url: pixUrl,
            pix_qr_code: pixCode,
        })
        .eq("id", invoiceId);

    await recordAttempt(admin, {
        company_id: sub.company_id,
        invoice_id: invoiceId,
        kind,
        channel: "pix",
        pagarme_order_id: order.id,
        status: "pending",
        attempt_n: attemptN,
    });

    return { orderId: order.id, pixUrl: pixUrl ?? null, pixCode: pixCode ?? null };
}

async function applyFallbackStatus(
    admin: Admin,
    sub: CollectSub,
    to: "overdue" | "pending_payment"
) {
    const r = await transitionBillingStatus(admin, {
        companyId: sub.company_id,
        to,
        casUpdatedAt: sub.updated_at ?? null,
    });
    if (r.status === "conflict") {
        billingLog("collect_payment", "status_transition_conflict", {
            company_id: sub.company_id,
            to,
            from: r.from,
            reason: r.reason,
        });
    }
}

/**
 * Coleta mensalidade: tenta cartão default se pedido; senão/falha → PIX na mesma invoice.
 */
export async function collectPayment(
    admin: Admin,
    params: {
        sub: CollectSub;
        kind: CollectPaymentKind;
        prefer: "card" | "pix";
        attemptN: number;
        now: Date;
        /** Status da assinatura se cair em PIX (não paid). */
        fallbackSubStatus: "overdue" | "pending_payment";
        notifyWhatsApp?: boolean;
    }
): Promise<CollectPaymentResult> {
    const { sub, kind, prefer, attemptN, now, fallbackSubStatus, notifyWhatsApp = true } = params;
    const company = companyOf(sub);

    const invoice = await ensurePendingInvoice(admin, sub, now);
    if (!invoice) {
        return { ok: true, outcome: "skipped_existing", invoiceId: null };
    }

    // Já tem PIX EMV e prefer=pix: reconcilia paid; senão mantém pending
    if (prefer === "pix" && invoice.pix_qr_code && invoice.pagarme_order_id) {
        const recon = await reconcileOrCancelLiveOrder(
            admin,
            invoice.pagarme_order_id,
            "invoice"
        );
        if (recon.action === "fulfilled") {
            return {
                ok: true,
                outcome: "paid_card",
                invoiceId: invoice.id,
                orderId: invoice.pagarme_order_id,
            };
        }
        await applyFallbackStatus(admin, sub, fallbackSubStatus);
        return {
            ok: true,
            outcome: "pix_pending",
            invoiceId: invoice.id,
            orderId: invoice.pagarme_order_id,
        };
    }

    if (prefer === "card" && sub.default_card_id && sub.pagarme_customer_id) {
        try {
            const recon = await reconcileOrCancelLiveOrder(
                admin,
                invoice.pagarme_order_id,
                "invoice"
            );
            if (recon.action === "fulfilled") {
                return {
                    ok: true,
                    outcome: "paid_card",
                    invoiceId: invoice.id,
                    orderId: invoice.pagarme_order_id ?? "",
                };
            }

            const order = await createOrderWithSavedCard({
                amountCents: invoice.amountCents,
                description: `Mensalidade Renthus — Plano ${sub.plan}`,
                itemCode: "invoice",
                customerId: sub.pagarme_customer_id,
                cardId: sub.default_card_id,
                recurrence: true,
                metadata: {
                    type: "invoice",
                    company_id: sub.company_id,
                    subscription_id: sub.id,
                    plan: String(sub.plan ?? ""),
                    invoice_id: invoice.id,
                },
            });

            await admin
                .from("invoices")
                .update({ pagarme_order_id: order.id })
                .eq("id", invoice.id);

            if (isOrderCreditPaid(order)) {
                await recordAttempt(admin, {
                    company_id: sub.company_id,
                    invoice_id: invoice.id,
                    kind,
                    channel: "card",
                    pagarme_order_id: order.id,
                    status: "paid",
                    attempt_n: attemptN,
                });
                await admin
                    .from("pagarme_subscriptions")
                    .update({ default_card_id: sub.default_card_id })
                    .eq("id", sub.id)
                    .is("default_card_id", null);
                await fulfillPayment(admin, order as PagarmeOrder);
                billingLog("collect_payment", "paid_card", {
                    company_id: sub.company_id,
                    invoice_id: invoice.id,
                    order_id: order.id,
                    attempt_n: attemptN,
                });
                return {
                    ok: true,
                    outcome: "paid_card",
                    invoiceId: invoice.id,
                    orderId: order.id,
                };
            }

            const lastTx = order.charges?.[0]?.last_transaction as
                | { acquirer_message?: string; status?: string }
                | undefined;
            const decline =
                lastTx?.acquirer_message ??
                lastTx?.status ??
                order.charges?.[0]?.status ??
                "card_not_paid";

            await recordAttempt(admin, {
                company_id: sub.company_id,
                invoice_id: invoice.id,
                kind,
                channel: "card",
                pagarme_order_id: order.id,
                status: "failed",
                decline_code: String(decline).slice(0, 200),
                attempt_n: attemptN,
                error_message: String(decline).slice(0, 500),
            });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            await recordAttempt(admin, {
                company_id: sub.company_id,
                invoice_id: invoice.id,
                kind,
                channel: "card",
                pagarme_order_id: null,
                status: "failed",
                attempt_n: attemptN,
                error_message: msg.slice(0, 500),
            });
            billingLog("collect_payment", "card_error", {
                company_id: sub.company_id,
                error: msg,
            });
        }
    }

    // Fallback / path PIX
    const pix = await attachPixToInvoice(
        admin,
        sub,
        invoice.id,
        kind,
        attemptN,
        invoice.pagarme_order_id,
        invoice.amountCents
    );

    if ("fulfilled" in pix && pix.fulfilled) {
        return {
            ok: true,
            outcome: "paid_card",
            invoiceId: invoice.id,
            orderId: pix.orderId,
        };
    }

    await applyFallbackStatus(admin, sub, fallbackSubStatus);

    if (notifyWhatsApp && company?.whatsapp_phone) {
        const msg = buildOverdueMessage(1, pix.pixUrl ?? pix.pixCode ?? "");
        if (msg) await sendBillingNotification(sub.company_id, company.whatsapp_phone, msg);
    }

    billingLog("collect_payment", "pix_pending", {
        company_id: sub.company_id,
        invoice_id: invoice.id,
        order_id: pix.orderId,
        attempt_n: attemptN,
    });

    return {
        ok: true,
        outcome: "pix_pending",
        invoiceId: invoice.id,
        orderId: pix.orderId,
    };
}
