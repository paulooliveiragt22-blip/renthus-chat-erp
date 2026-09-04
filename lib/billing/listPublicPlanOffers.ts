/**
 * Catálogo público para /signup — service_role no Route Handler.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_CATALOG, PLAN_ORDER, type CommercialPlanKey } from "@/lib/billing/planCatalog";
import { applyPromoAdjustmentCents } from "@/lib/billing/subscriptionAmount";
import { findActivePlanPromotion } from "@/lib/billing/resolvePromoForCharge";
import { formatBrlFromCents } from "@/lib/billing/moneyDisplay";
import type { UiPublicPlanOffer } from "@/lib/billing/contracts/publicPlans";

function isCommercialKey(k: string): k is CommercialPlanKey {
    return k === "essencial" || k === "pro" || k === "market";
}

export async function listPublicPlanOffers(
    admin: SupabaseClient,
    now = new Date()
): Promise<UiPublicPlanOffer[]> {
    const { data, error } = await admin
        .from("plans")
        .select(
            "id, key, name, description, price_cents, price_year_cents, included_seats, seat_extra_cents"
        )
        .in("key", PLAN_ORDER);
    if (error) throw new Error(error.message);

    const byKey = new Map(
        (data ?? []).map((r) => [String(r.key), r as Record<string, unknown>])
    );

    const out: UiPublicPlanOffer[] = [];
    for (const key of PLAN_ORDER) {
        const catalog = PLAN_CATALOG[key];
        const row = byKey.get(key);
        const listMonthly =
            typeof row?.price_cents === "number" && row.price_cents > 0
                ? row.price_cents
                : catalog.monthlyPriceCents;
        const listYearly =
            typeof row?.price_year_cents === "number" && row.price_year_cents > 0
                ? row.price_year_cents
                : catalog.yearlyPriceCents;
        const planId = typeof row?.id === "string" ? row.id : null;

        let promo: UiPublicPlanOffer["promo"] = null;
        let offerMonthly = listMonthly;
        if (planId) {
            const rule = await findActivePlanPromotion(admin, planId, now);
            if (rule && rule.adjustment_kind === "discount") {
                offerMonthly = applyPromoAdjustmentCents(listMonthly, rule);
                if (offerMonthly < listMonthly) {
                    promo = {
                        duration_months: rule.duration_months,
                        list_monthly_cents: listMonthly,
                        offer_monthly_cents: offerMonthly,
                        label_de_por: `De ${formatBrlFromCents(listMonthly)} por ${formatBrlFromCents(offerMonthly)}`,
                    };
                }
            }
        }

        out.push({
            key,
            name: typeof row?.name === "string" ? row.name : catalog.name,
            description:
                typeof row?.description === "string"
                    ? row.description
                    : catalog.description,
            list_monthly_cents: listMonthly,
            offer_monthly_cents: offerMonthly,
            list_yearly_cents: listYearly,
            included_seats:
                row?.included_seats == null
                    ? catalog.includedSeats
                    : Number(row.included_seats),
            seat_extra_cents:
                row?.seat_extra_cents === undefined
                    ? catalog.seatExtraCents
                    : row.seat_extra_cents == null
                      ? null
                      : Number(row.seat_extra_cents),
            popular: Boolean(catalog.popular),
            promo,
        });
    }

    return out.filter((p) => isCommercialKey(p.key));
}
