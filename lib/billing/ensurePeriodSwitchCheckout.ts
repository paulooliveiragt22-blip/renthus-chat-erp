/**
 * Checkout de troca de ciclo mensal → anual (pay-to-switch).
 * Obrigação e applied_free: rpc_ensure_period_switch_obligation (amount + next no banco).
 * Após paid, rpc_fulfill_obligation (kind=period_switch) vira billing_period='year'.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { centsToBRL } from "@/lib/billing/pagarme";
import { reconcileOrCancelLiveOrder } from "@/lib/billing/reconcileLivePagarmeOrder";
import { normalizePlanKey, type CommercialPlanKey } from "@/lib/billing/planCatalog";

type Admin = ReturnType<typeof createAdminClient>;

export type EnsurePeriodSwitchCheckoutResult =
    | {
          mode: "pending";
          invoiceId: string;
          amountCents: number;
          amountBrl: number;
          annualCents: number;
          creditCents: number;
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
        /** Upgrade combinado mensal→anual para outro plano (Market etc.). */
        targetPlan?: string;
    }
): Promise<EnsurePeriodSwitchCheckoutResult> {
    const { data: sub, error: subErr } = await admin
        .from("pagarme_subscriptions")
        .select("id, plan, status, billing_period, pagarme_customer_id, next_billing_at, last_paid_at")
        .eq("company_id", params.companyId)
        .maybeSingle();
    if (subErr) throw new Error(subErr.message);
    if (!sub) throw new Error("subscription_not_found");
    if (String(sub.status ?? "") !== "active") throw new Error("subscription_not_eligible");
    const lastPaid = sub.last_paid_at;
    if (lastPaid == null || String(lastPaid).trim() === "") {
        throw new Error("never_paid_use_set_period");
    }
    if (String(sub.billing_period ?? "month").toLowerCase() === "year") {
        throw new Error("already_annual");
    }

    const target =
        normalizePlanKey(String(params.targetPlan ?? "").trim()) ??
        normalizePlanKey(String(sub.plan ?? "")) ??
        "essencial";
    const plan = target;

    const { data: oblRaw, error: oblErr } = await admin.rpc(
        "rpc_ensure_period_switch_obligation",
        {
            p_company_id: params.companyId,
            p_target_plan: params.targetPlan ? target : null,
        }
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

    const recon = await reconcileOrCancelLiveOrder(admin, priorOrderId, "period_switch");
    if (recon.action === "fulfilled") {
        throw new Error("already_fulfilled");
    }

    return {
        mode: "pending",
        invoiceId,
        amountCents,
        amountBrl: catalogBrl,
        annualCents,
        creditCents,
        plan,
        nextBillingAt: sub.next_billing_at ? String(sub.next_billing_at) : null,
    };
}
