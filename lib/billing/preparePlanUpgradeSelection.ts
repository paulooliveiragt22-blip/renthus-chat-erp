/**
 * Seleção de upgrade (BN-11): quote + intent na sub — sem INSERT em invoices.
 * Invoice/PSP só em create-invoice-checkout via ensurePlanUpgradeObligation.
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

export type PreparePlanUpgradeResult =
    | {
          mode: "quoted";
          amountCents: number;
          amountBrl: number;
          fromPlan: CommercialPlanKey;
          toPlan: CommercialPlanKey;
          nextBillingAt: string | null;
      }
    | {
          mode: "applied_free";
          fromPlan: CommercialPlanKey;
          toPlan: CommercialPlanKey;
      };

export async function preparePlanUpgradeSelection(
    admin: Admin,
    params: {
        companyId: string;
        targetPlan: string;
    }
): Promise<PreparePlanUpgradeResult> {
    const toPlan = parseCommercialPlanInput(params.targetPlan);
    if (!toPlan) throw new Error("plan_invalid");

    const { data: sub, error: subErr } = await admin
        .from("pagarme_subscriptions")
        .select(
            "id, plan, status, next_billing_at, seat_quantity, last_paid_at"
        )
        .eq("company_id", params.companyId)
        .maybeSingle();
    if (subErr) throw new Error(subErr.message);
    if (!sub) throw new Error("subscription_not_found");

    const st = String(sub.status ?? "");
    if (st !== "active") throw new Error("subscription_not_eligible");
    const lastPaid = (sub as { last_paid_at?: string | null }).last_paid_at;
    if (lastPaid == null || String(lastPaid).trim() === "") {
        throw new Error("never_paid_use_change_plan");
    }

    const fromPlan = normalizePlanKey(String(sub.plan ?? ""));
    if (!fromPlan) throw new Error("plan_invalid");
    if (planRank(toPlan) <= planRank(fromPlan)) throw new Error("not_an_upgrade");

    const { data: quoteRaw, error: quoteErr } = await admin.rpc("rpc_quote_plan_upgrade", {
        p_company_id: params.companyId,
        p_target_plan: toPlan,
    });
    if (quoteErr) throw new Error(quoteErr.message);
    const quote = (quoteRaw ?? {}) as { amount_cents?: number; applied_free?: boolean };
    const amountCents = Math.floor(Number(quote.amount_cents ?? 0));

    if (quote.applied_free === true || amountCents <= 0) {
        const toPricing = await loadPlanPricing(admin, toPlan);
        const { error: upErr } = await admin
            .from("pagarme_subscriptions")
            .update({
                plan: toPlan,
                pending_plan_key: null,
                pending_plan_change_at: null,
                pending_keep_user_ids: null,
                pending_upgrade_plan_key: null,
                pending_checkout_intent: null,
                seat_quantity: Math.max(
                    typeof sub.seat_quantity === "number" ? sub.seat_quantity : 1,
                    toPricing.includedSeats
                ),
                updated_at: new Date().toISOString(),
            })
            .eq("id", sub.id);
        if (upErr) throw new Error(upErr.message);
        await syncLogicalSubscription(admin, params.companyId, toPlan);
        return { mode: "applied_free", fromPlan, toPlan };
    }

    // Limpa invoice upgrade stale (bug anterior) sem criar nova.
    await admin
        .from("invoices")
        .update({ status: "cancelled" })
        .eq("company_id", params.companyId)
        .eq("kind", "plan_upgrade")
        .eq("status", "pending");

    const { error: intentErr } = await admin
        .from("pagarme_subscriptions")
        .update({
            pending_upgrade_plan_key: toPlan,
            pending_checkout_intent: null,
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
        fromPlan,
        toPlan,
        nextBillingAt: sub.next_billing_at ? String(sub.next_billing_at) : null,
    };
}
