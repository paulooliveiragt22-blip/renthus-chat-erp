import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    PLAN_CATALOG,
    normalizePlanKey,
    type CommercialPlanKey,
    type PlanInputKey,
} from "@/lib/billing/planCatalog";
import type { PlanPricingInput } from "@/lib/billing/subscriptionAmount";

export type LoadedPlanPricing = PlanPricingInput & {
    planKey: CommercialPlanKey;
    planId: string | null;
};

/** Preço de lista do DB (`plans`); fallback = planCatalog. */
export async function loadPlanPricing(
    admin: SupabaseClient,
    plan: PlanInputKey | string
): Promise<LoadedPlanPricing> {
    const key = normalizePlanKey(plan) ?? "essencial";
    const catalog = PLAN_CATALOG[key];

    const { data, error } = await admin
        .from("plans")
        .select("id, key, price_cents, price_year_cents, included_seats, seat_extra_cents")
        .eq("key", key)
        .maybeSingle();

    if (error || !data) {
        return {
            planKey: key,
            planId: null,
            monthlyPriceCents: catalog.monthlyPriceCents,
            yearlyPriceCents: catalog.yearlyPriceCents,
            includedSeats: catalog.includedSeats,
            seatExtraCents: catalog.seatExtraCents,
        };
    }

    const monthly =
        typeof data.price_cents === "number" && data.price_cents > 0
            ? data.price_cents
            : catalog.monthlyPriceCents;
    const yearly =
        typeof data.price_year_cents === "number" && data.price_year_cents > 0
            ? data.price_year_cents
            : catalog.yearlyPriceCents;
    const included =
        typeof data.included_seats === "number" && data.included_seats >= 1
            ? data.included_seats
            : catalog.includedSeats;
    const seatExtra =
        data.seat_extra_cents == null
            ? catalog.seatExtraCents
            : Number(data.seat_extra_cents);

    return {
        planKey: key,
        planId: typeof data.id === "string" ? data.id : null,
        monthlyPriceCents: monthly,
        yearlyPriceCents: yearly,
        includedSeats: included,
        seatExtraCents:
            seatExtra == null || !Number.isFinite(seatExtra) ? null : Math.floor(seatExtra),
    };
}
