/**
 * Seleção mensal → anual (qualquer plano destino: igual, superior ou inferior).
 * Amount canônico no DB; keep_users obrigatório se downgrade com excesso de seats.
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
          rankDelta: number;
      }
    | {
          mode: "applied_free";
          fromPlan: CommercialPlanKey;
          toPlan: CommercialPlanKey;
      };

function mapKeepError(raw: string): Error {
    const m = String(raw ?? "").toLowerCase();
    if (m.includes("need_at_least_one_admin")) {
        return new Error("need_at_least_one_admin");
    }
    if (m.includes("selection_invalid")) {
        return new Error("selection_invalid");
    }
    const upTo = m.match(/select_up_to_(\d+) users/);
    if (upTo) return new Error(`select_up_to_${upTo[1]}_users`);
    const atMost = m.match(/select_at_most_(\d+) users/);
    if (atMost) return new Error(`select_at_most_${atMost[1]}_users`);
    return new Error(raw);
}

export async function prepareUpgradeToAnnualSelection(
    admin: Admin,
    params: {
        companyId: string;
        targetPlan: string;
        keepUserIds?: string[];
    }
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

    const rankDelta = planRank(toPlan) - planRank(fromPlan);
    let keepIds: string[] | null = null;

    if (rankDelta < 0) {
        const { data: keepRaw, error: keepErr } = await admin.rpc("rpc_resolve_keep_user_ids", {
            p_company_id: params.companyId,
            p_target_plan: toPlan,
            p_keep_user_ids: Array.isArray(params.keepUserIds) ? params.keepUserIds : [],
        });
        if (keepErr) throw mapKeepError(keepErr.message);
        keepIds = Array.isArray(keepRaw) ? keepRaw.map(String) : [];
    }

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
        if (keepIds) {
            const { error: keepStoreErr } = await admin
                .from("pagarme_subscriptions")
                .update({
                    pending_keep_user_ids: keepIds,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", sub.id);
            if (keepStoreErr) throw new Error(keepStoreErr.message);
        }

        const { data: applied, error: applyErr } = await admin.rpc(
            "rpc_ensure_period_switch_obligation",
            { p_company_id: params.companyId, p_target_plan: toPlan }
        );
        if (applyErr) throw new Error(applyErr.message);
        void applied;

        if (keepIds && keepIds.length > 0) {
            const keepSet = new Set(keepIds);
            const { data: actives } = await admin
                .from("company_users")
                .select("user_id")
                .eq("company_id", params.companyId)
                .eq("is_active", true);
            const toDrop = (actives ?? [])
                .map((r) => String(r.user_id))
                .filter((id) => !keepSet.has(id));
            await Promise.allSettled(
                toDrop.map((uid) =>
                    admin
                        .from("company_users")
                        .update({ is_active: false })
                        .eq("company_id", params.companyId)
                        .eq("user_id", uid)
                )
            );
            const pricing = await loadPlanPricing(admin, toPlan);
            await admin
                .from("pagarme_subscriptions")
                .update({
                    pending_keep_user_ids: null,
                    seat_quantity: pricing.includedSeats,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", sub.id);
        }

        await syncLogicalSubscription(admin, params.companyId, toPlan);
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
            pending_keep_user_ids: keepIds,
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
        rankDelta,
    };
}
