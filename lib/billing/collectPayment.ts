/**
 * CollectPayment — card-first na mesma obrigação (invoice), fallback PIX + EMV.
 * Usado pelo cron de renovação e retries D1/D3.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    createOrderWithSavedCard,
    createPixInvoiceOrder,
    getMonthlyPriceCents,
    centsToBRL,
    isOrderCreditPaid,
    resolvePixFromOrder,
    type PagarmeOrder,
} from "@/lib/billing/pagarme";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";
import { fulfillPayment } from "@/lib/billing/fulfillPayment";
import { billingLog } from "@/lib/billing/billingLog";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";
import { sendBillingNotification, buildOverdueMessage } from "@/lib/billing/sendBillingNotification";

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

async function ensurePendingInvoice(
    admin: Admin,
    sub: CollectSub,
    now: Date
): Promise<{ id: string; pagarme_order_id: string | null; pix_qr_code: string | null; created: boolean } | null> {
    const { data: existing } = await admin
        .from("invoices")
        .select("id, pagarme_order_id, pix_qr_code")
        .eq("subscription_id", sub.id)
        .eq("status", "pending")
        .maybeSingle();

    if (existing?.id) {
        return {
            id: existing.id,
            pagarme_order_id: existing.pagarme_order_id ?? null,
            pix_qr_code: existing.pix_qr_code ?? null,
            created: false,
        };
    }

    const amountCents = getMonthlyPriceCents(String(sub.plan ?? "essencial"));
    const { data: claimed, error: claimErr } = await admin
        .from("invoices")
        .insert({
            company_id:          sub.company_id,
            subscription_id:     sub.id,
            amount:              centsToBRL(amountCents),
            status:              "pending",
            due_at:              now.toISOString(),
            pagarme_order_id:    null,
            pagarme_payment_url: null,
            pix_qr_code:         null,
        })
        .select("id, pagarme_order_id, pix_qr_code")
        .single();

    if (claimErr) {
        if (isUniqueViolation(claimErr)) {
            const { data: again } = await admin
                .from("invoices")
                .select("id, pagarme_order_id, pix_qr_code")
                .eq("subscription_id", sub.id)
                .eq("status", "pending")
                .maybeSingle();
            if (again?.id) {
                return {
                    id: again.id,
                    pagarme_order_id: again.pagarme_order_id ?? null,
                    pix_qr_code: again.pix_qr_code ?? null,
                    created: false,
                };
            }
            return null;
        }
        throw new Error(claimErr.message);
    }

    return {
        id: claimed.id,
        pagarme_order_id: claimed.pagarme_order_id ?? null,
        pix_qr_code: claimed.pix_qr_code ?? null,
        created: true,
    };
}

async function attachPixToInvoice(
    admin: Admin,
    sub: CollectSub,
    invoiceId: string,
    kind: CollectPaymentKind,
    attemptN: number
): Promise<{ orderId: string | null; pixUrl: string | null; pixCode: string | null }> {
    const company = companyOf(sub);
    const amountCents = getMonthlyPriceCents(String(sub.plan ?? "essencial"));
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

    // Já tem PIX EMV e prefer=pix sem cartão nesta passada: só garante status
    if (prefer === "pix" && invoice.pix_qr_code && invoice.pagarme_order_id) {
        await admin
            .from("pagarme_subscriptions")
            .update({ status: fallbackSubStatus })
            .eq("id", sub.id);
        return {
            ok: true,
            outcome: "pix_pending",
            invoiceId: invoice.id,
            orderId: invoice.pagarme_order_id,
        };
    }

    if (prefer === "card" && sub.default_card_id && sub.pagarme_customer_id) {
        try {
            const amountCents = getMonthlyPriceCents(String(sub.plan ?? "essencial"));
            const order = await createOrderWithSavedCard({
                amountCents,
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
                // Garante default_card_id para próximos ciclos (mesmo se já setado).
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
    const pix = await attachPixToInvoice(admin, sub, invoice.id, kind, attemptN);

    await admin
        .from("pagarme_subscriptions")
        .update({ status: fallbackSubStatus })
        .eq("id", sub.id);

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
