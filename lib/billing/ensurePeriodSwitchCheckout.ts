/**
 * Checkout de troca de ciclo mensal → anual (pay-to-switch).
 * Obrigação e applied_free: rpc_ensure_period_switch_obligation (amount + next no banco).
 * Após paid, rpc_fulfill_obligation (kind=period_switch) vira billing_period='year'.
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

type EnsureObligationRpc = {
    status?: string;
    applied_free?: boolean;
    invoice_id?: string;
    amount_cents?: number;
    annual_cents?: number;
    credit_cents?: number;
    plan?: string;
    pagarme_order_id?: string | null;
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

    // Fonte canônica: quote + insert/applied_free no banco (nunca amount/+1y no app).
    const { data: oblRaw, error: oblErr } = await admin.rpc(
        "rpc_ensure_period_switch_obligation",
        { p_company_id: params.companyId }
    );
    if (oblErr) throw new Error(oblErr.message);
    const obl = (oblRaw ?? {}) as EnsureObligationRpc;
    const amountCents = Math.floor(Number(obl.amount_cents ?? 0));
    const annualCents = Math.floor(Number(obl.annual_cents ?? 0));
    const creditCents = Math.floor(Number(obl.credit_cents ?? 0));
    const catalogBrl = centsToBRL(amountCents);

    if (obl.applied_free === true || obl.status === "applied_free" || amountCents <= 0) {
        return { mode: "applied_free", plan };
    }

    const invoiceId = typeof obl.invoice_id === "string" ? obl.invoice_id : null;
    if (!invoiceId) throw new Error("invoice_create_failed");
    const priorOrderId =
        typeof obl.pagarme_order_id === "string" ? obl.pagarme_order_id : null;

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
