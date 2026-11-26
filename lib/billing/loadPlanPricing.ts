import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
    OFFICE_PLAN,
    PLAN_CATALOG,
    isOfficePlanKey,
    normalizePlanKey,
    type PlanInputKey,
    type SignupPlanKey,
} from "@/lib/billing/planCatalog";
import type { PlanPricingInput } from "@/lib/billing/subscriptionAmount";

export type LoadedPlanPricing = PlanPricingInput & {
    planKey: SignupPlanKey;
    planId: string | null;
};

/** Preço de lista do DB (`plans`); fallback = planCatalog. */
export async function loadPlanPricing(
    admin: SupabaseClient,
    plan: PlanInputKey | string
): Promise<LoadedPlanPricing> {
    if (isOfficePlanKey(plan)) return loadOfficePlanPricing(admin);

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

async function loadOfficePlanPricing(admin: SupabaseClient): Promise<LoadedPlanPricing> {
    const { data, error } = await admin
        .from("plans")
        .select("id, price_cents, price_year_cents, included_seats, product_line")
        .eq("key", "office")
        .maybeSingle();

    const monthly = Number(data?.price_cents);
    const yearly = Number(data?.price_year_cents);
    if (error || !data || data.product_line !== "office" || monthly <= 0 || yearly <= 0) {
        throw new Error("office_plan_missing");
    }

    const included =
        typeof data.included_seats === "number" && data.included_seats >= 1
            ? data.included_seats
            : OFFICE_PLAN.includedSeats;

    return {
        planKey: "office",
        planId: typeof data.id === "string" ? data.id : null,
        monthlyPriceCents: monthly,
        yearlyPriceCents: yearly,
        includedSeats: included,
        seatExtraCents: null,
    };
}
