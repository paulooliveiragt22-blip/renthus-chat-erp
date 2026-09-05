/**
 * Seleção upgrade + anual (mensal ativo → plano maior anual) num pagamento.
 * Quote no DB; intent na sub; invoice só no materialize/checkout.
 */

import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { centsToBRL } from "@/lib/billing/pagarme";
import { loadPlanPricing } from "@/lib/billing/loadPlanPricing";
import {
    normalizePlanKey,
    parseCommercialPlanInput,
    planRank,
    type CommercialPlanKey,
} from "@/lib/billing/planCatalog";
import { syncLogicalSubscription } from "@/lib/billing/pagarmeSetupPaid";

type Admin = ReturnType<typeof createAdminClient>;

export type PrepareUpgradeToAnnualResult =
    | {
          mode: "quoted";
          amountCents: number;
          amountBrl: number;
          annualCents: number;
          creditCents: number;
          fromPlan: CommercialPlanKey;
          toPlan: CommercialPlanKey;
          nextBillingAt: string | null;
      }
    | {
          mode: "applied_free";
          fromPlan: CommercialPlanKey;
          toPlan: CommercialPlanKey;
      };

export async function prepareUpgradeToAnnualSelection(
    admin: Admin,
    params: { companyId: string; targetPlan: string }
): Promise<PrepareUpgradeToAnnualResult> {
    const toPlan = parseCommercialPlanInput(params.targetPlan);
    if (!toPlan) throw new Error("plan_invalid");

    const { data: sub, error: subErr } = await admin
        .from("pagarme_subscriptions")
        .select("id, plan, status, billing_period, next_billing_at, seat_quantity, last_paid_at")
        .eq("company_id", params.companyId)
        .maybeSingle();
    if (subErr) throw new Error(subErr.message);
    if (!sub) throw new Error("subscription_not_found");

    if (String(sub.status ?? "") !== "active") throw new Error("subscription_not_eligible");
    const lastPaid = sub.last_paid_at;
    if (lastPaid == null || String(lastPaid).trim() === "") {
        throw new Error("never_paid_use_change_plan");
    }
    if (String(sub.billing_period ?? "month").toLowerCase() === "year") {
        throw new Error("already_annual_use_upgrade");
    }

    const fromPlan = normalizePlanKey(String(sub.plan ?? ""));
    if (!fromPlan) throw new Error("plan_invalid");
    if (planRank(toPlan) <= planRank(fromPlan)) throw new Error("not_an_upgrade");

    const { data: quoteRaw, error: quoteErr } = await admin.rpc("rpc_quote_period_switch", {
        p_company_id: params.companyId,
        p_target_plan: toPlan,
    });
    if (quoteErr) throw new Error(quoteErr.message);
    const quote = (quoteRaw ?? {}) as {
        amount_cents?: number;
        annual_cents?: number;
        credit_cents?: number;
        applied_free?: boolean;
    };
    const amountCents = Math.floor(Number(quote.amount_cents ?? 0));
    const annualCents = Math.floor(Number(quote.annual_cents ?? 0));
    const creditCents = Math.floor(Number(quote.credit_cents ?? 0));

    if (quote.applied_free === true || amountCents <= 0) {
        const { data: applied, error: applyErr } = await admin.rpc(
            "rpc_ensure_period_switch_obligation",
            { p_company_id: params.companyId, p_target_plan: toPlan }
        );
        if (applyErr) throw new Error(applyErr.message);
        void applied;
        const toPricing = await loadPlanPricing(admin, toPlan);
        await syncLogicalSubscription(admin, params.companyId, toPlan);
        void toPricing;
        return { mode: "applied_free", fromPlan, toPlan };
    }

    await admin
        .from("invoices")
        .update({ status: "cancelled" })
        .eq("company_id", params.companyId)
        .in("kind", ["plan_upgrade", "period_switch"])
        .eq("status", "pending");

    const { error: intentErr } = await admin
        .from("pagarme_subscriptions")
        .update({
            pending_upgrade_plan_key: toPlan,
            pending_checkout_intent: "upgrade_to_annual",
            pending_plan_key: null,
            pending_plan_change_at: null,
            pending_keep_user_ids: null,
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
        fromPlan,
        toPlan,
        nextBillingAt: sub.next_billing_at ? String(sub.next_billing_at) : null,
    };
}
