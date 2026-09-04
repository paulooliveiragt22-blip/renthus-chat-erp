/**
 * Checkout de troca de ciclo mensal → anual (pay-to-switch).
 * Valor canônico (annual − crédito do mês) vem de rpc_quote_period_switch.
 * Após paid, rpc_fulfill_obligation (kind=period_switch) vira billing_period='year'
 * e reinicia o ciclo (+1 ano). App nunca calcula/grava o valor.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
    createPixInvoiceOrder,
    resolvePixFromOrder,
    centsToBRL,
} from "@/lib/billing/pagarme";
import { buildPagarmeCustomerPayload } from "@/lib/billing/buildPagarmeCustomerFromCompany";
import { reconcileOrCancelLiveOrder } from "@/lib/billing/reconcileLivePagarmeOrder";
import { isUniqueViolation } from "@/lib/billing/isUniqueViolation";
import { normalizePlanKey, type CommercialPlanKey } from "@/lib/billing/planCatalog";

type Admin = ReturnType<typeof createAdminClient>;

export type EnsurePeriodSwitchCheckoutResult =
    | {
          mode: "checkout";
          invoiceId: string;
          orderId: string;
          amountCents: number;
          amountBrl: number;
          annualCents: number;
          creditCents: number;
          pixQrCode: string | null;
          pixUrl: string | null;
          plan: CommercialPlanKey;
          nextBillingAt: string | null;
      }
    | {
          mode: "applied_free";
          plan: CommercialPlanKey;
      };

type QuoteRpc = {
    amount_cents?: number;
    annual_cents?: number;
    credit_cents?: number;
    applied_free?: boolean;
    plan?: string;
};

export async function ensurePeriodSwitchCheckout(
    admin: Admin,
    params: {
        companyId: string;
        company: {
            name?: string | null;
            nome_fantasia?: string | null;
            email?: string | null;
            whatsapp_phone?: string | null;
            phone?: string | null;
            cnpj?: string | null;
        };
    }
): Promise<EnsurePeriodSwitchCheckoutResult> {
    const { data: sub, error: subErr } = await admin
        .from("pagarme_subscriptions")
        .select("id, plan, status, billing_period, pagarme_customer_id, next_billing_at")
        .eq("company_id", params.companyId)
        .maybeSingle();
    if (subErr) throw new Error(subErr.message);
    if (!sub) throw new Error("subscription_not_found");
    if (String(sub.status ?? "") !== "active") throw new Error("subscription_not_eligible");
    if (String(sub.billing_period ?? "month").toLowerCase() === "year") {
        throw new Error("already_annual");
    }

    const plan = normalizePlanKey(String(sub.plan ?? "")) ?? "essencial";

    // Fonte canônica do valor: banco (annual − crédito do mês corrente).
    const { data: quoteRaw, error: quoteErr } = await admin.rpc("rpc_quote_period_switch", {
        p_company_id: params.companyId,
    });
    if (quoteErr) throw new Error(quoteErr.message);
    const quote = (quoteRaw ?? {}) as QuoteRpc;
    const amountCents = Math.floor(Number(quote.amount_cents ?? 0));
    const annualCents = Math.floor(Number(quote.annual_cents ?? 0));
    const creditCents = Math.floor(Number(quote.credit_cents ?? 0));

    // Edge: crédito ≥ anual → aplica direto (raro; anual >> 1 mês).
    if (quote.applied_free === true || amountCents <= 0) {
        const oneYear = new Date();
        oneYear.setFullYear(oneYear.getFullYear() + 1);
        const { error: upErr } = await admin
            .from("pagarme_subscriptions")
            .update({
                billing_period: "year",
                next_billing_at: oneYear.toISOString(),
                last_paid_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq("id", sub.id);
        if (upErr) throw new Error(upErr.message);
        return { mode: "applied_free", plan };
    }

    let invoiceId: string | null = null;
    let priorOrderId: string | null = null;

    const { data: pending } = await admin
        .from("invoices")
        .select("id, pagarme_order_id, amount")
        .eq("company_id", params.companyId)
        .eq("status", "pending")
        .eq("kind", "period_switch")
        .maybeSingle();

    const catalogBrl = centsToBRL(amountCents);

    if (pending?.id) {
        invoiceId = pending.id;
        priorOrderId = pending.pagarme_order_id ?? null;
        if (Math.abs(Number(pending.amount) - catalogBrl) > 0.02) {
            await admin
                .from("invoices")
                .update({
                    amount: catalogBrl,
                    pagarme_order_id: null,
                    pagarme_payment_url: null,
                    pix_qr_code: null,
                })
                .eq("id", pending.id)
                .eq("status", "pending");
            priorOrderId = null;
        }
    } else {
        const { data: created, error: insErr } = await admin
            .from("invoices")
            .insert({
                company_id: params.companyId,
                subscription_id: sub.id,
                amount: catalogBrl,
                status: "pending",
                kind: "period_switch",
                due_at: new Date().toISOString(),
            })
            .select("id")
            .single();
        if (insErr) {
            if (isUniqueViolation(insErr)) {
                const { data: again } = await admin
                    .from("invoices")
                    .select("id, pagarme_order_id")
                    .eq("company_id", params.companyId)
                    .eq("status", "pending")
                    .eq("kind", "period_switch")
                    .maybeSingle();
                if (!again?.id) throw new Error(insErr.message);
                invoiceId = again.id;
                priorOrderId = again.pagarme_order_id ?? null;
            } else {
                throw new Error(insErr.message);
            }
        } else {
            invoiceId = created!.id;
        }
    }

    if (!invoiceId) throw new Error("invoice_create_failed");

    const recon = await reconcileOrCancelLiveOrder(admin, priorOrderId, "invoice");
    if (recon.action === "fulfilled") {
        throw new Error("already_fulfilled");
    }

    const customerId =
        typeof sub.pagarme_customer_id === "string" ? sub.pagarme_customer_id : undefined;
    const customerPayload = buildPagarmeCustomerPayload({
        id: params.companyId,
        name: params.company.name ?? null,
        nome_fantasia: params.company.nome_fantasia ?? null,
        email: params.company.email ?? null,
        whatsapp_phone: params.company.whatsapp_phone ?? params.company.phone ?? null,
        cnpj: params.company.cnpj ?? null,
    });

    const created = await createPixInvoiceOrder({
        amountCents,
        description: `Renthus ${plan} — migração para plano anual`,
        itemCode: "period_switch",
        expiresInSeconds: 3600,
        customerId,
        customer: customerId ? undefined : customerPayload,
        metadata: {
            type: "period_switch",
            company_id: params.companyId,
            subscription_id: String(sub.id),
            plan,
            invoice_id: invoiceId,
        },
    });

    const { order, pixCode, pixUrl } = await resolvePixFromOrder(created);
    if (!pixCode && !pixUrl) {
        throw new Error("pix_payload_missing");
    }

    await admin
        .from("invoices")
        .update({
            pagarme_order_id: order.id,
            pagarme_payment_url: pixUrl,
            pix_qr_code: pixCode,
            amount: catalogBrl,
        })
        .eq("id", invoiceId);

    return {
        mode: "checkout",
        invoiceId,
        orderId: order.id,
        amountCents,
        amountBrl: catalogBrl,
        annualCents,
        creditCents,
        pixQrCode: pixCode,
        pixUrl,
        plan,
        nextBillingAt: sub.next_billing_at ? String(sub.next_billing_at) : null,
    };
}
