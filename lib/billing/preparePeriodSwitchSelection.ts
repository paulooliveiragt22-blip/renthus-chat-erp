/**
 * Seleção migrar mensal→anual: quote + intent — sem INSERT em invoices.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { centsToBRL } from "@/lib/billing/pagarme";
import { normalizePlanKey, type CommercialPlanKey } from "@/lib/billing/planCatalog";

type Admin = ReturnType<typeof createAdminClient>;

export type PreparePeriodSwitchResult =
    | {
          mode: "quoted";
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

type QuoteRpc = {
    amount_cents?: number;
    annual_cents?: number;
    credit_cents?: number;
    plan?: string;
    applied_free?: boolean;
};

export async function preparePeriodSwitchSelection(
    admin: Admin,
    params: { companyId: string }
): Promise<PreparePeriodSwitchResult> {
    const { data: sub, error: subErr } = await admin
        .from("pagarme_subscriptions")
        .select("id, plan, status, billing_period, next_billing_at, last_paid_at")
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

    const plan = normalizePlanKey(String(sub.plan ?? "")) ?? "essencial";

    const { data: quoteRaw, error: quoteErr } = await admin.rpc("rpc_quote_period_switch", {
        p_company_id: params.companyId,
    });
    if (quoteErr) throw new Error(quoteErr.message);
    const quote = (quoteRaw ?? {}) as QuoteRpc;
    const amountCents = Math.floor(Number(quote.amount_cents ?? 0));
    const annualCents = Math.floor(Number(quote.annual_cents ?? 0));
    const creditCents = Math.floor(Number(quote.credit_cents ?? 0));

    if (quote.applied_free === true || amountCents <= 0) {
        const { data: applied, error: applyErr } = await admin.rpc(
            "rpc_ensure_period_switch_obligation",
            { p_company_id: params.companyId }
        );
        if (applyErr) throw new Error(applyErr.message);
        void applied;
        return { mode: "applied_free", plan };
    }

    await admin
        .from("invoices")
        .update({ status: "cancelled" })
        .eq("company_id", params.companyId)
        .eq("kind", "period_switch")
        .eq("status", "pending");

    const { error: intentErr } = await admin
        .from("pagarme_subscriptions")
        .update({
            pending_checkout_intent: "period_switch",
            pending_upgrade_plan_key: null,
            updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id);
    if (intentErr) throw new Error(intentErr.message);

    return {
        mode: "quoted",
        amountCents,
        amountBrl: centsToBRL(amountCents),
        annualCents,
        creditCents,
        plan,
        nextBillingAt: sub.next_billing_at ? String(sub.next_billing_at) : null,
    };
}
