/**
 * Anexa promo ativa na adesão (R3-1) se a sub ainda não tem snapshot.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
    findActivePlanPromotion,
    snapshotFromRule,
} from "@/lib/billing/resolvePromoForCharge";
import { loadPlanPricing } from "@/lib/billing/loadPlanPricing";

export async function attachPromoOnAdesaoIfEligible(
    admin: SupabaseClient,
    companyId: string
): Promise<void> {
    const { data: sub } = await admin
        .from("pagarme_subscriptions")
        .select(
            "id, plan, billing_period, promo_id, promo_months_remaining, promo_snapshot, last_paid_at, status"
        )
        .eq("company_id", companyId)
        .maybeSingle();
    if (!sub) return;
    if (String(sub.billing_period ?? "month") === "year") return;
    if (sub.promo_id || (typeof sub.promo_months_remaining === "number" && sub.promo_months_remaining > 0)) {
        return;
    }
    // Só adesão: nunca pago ainda
    if (sub.last_paid_at) return;

    const pricing = await loadPlanPricing(admin, String(sub.plan ?? "essencial"));
    const rule = await findActivePlanPromotion(admin, pricing.planId);
    if (!rule) return;

    const snap = snapshotFromRule(rule);
    await admin
        .from("pagarme_subscriptions")
        .update({
            promo_id: rule.id,
            promo_months_remaining: rule.duration_months,
            promo_snapshot: snap,
            updated_at: new Date().toISOString(),
        })
        .eq("id", sub.id);
}
