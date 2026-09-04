import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import type { PlatformOpsAuditCtx } from "@/lib/platform/services/platformOps";
import { computeYearlyPriceCents } from "@/lib/billing/yearlyFromDiscount";
import type { YearlyDiscountMode } from "@/lib/billing/yearlyFromDiscount";

export type UpdatePlanPricingInput = {
    price_cents?: number;
    included_seats?: number;
    seat_extra_cents?: number | null;
    yearly_discount_mode?: YearlyDiscountMode;
    yearly_discount_value?: number;
    /** @deprecated use yearly_discount_* — ignorado se discount enviado */
    price_year_cents?: number | null;
};

const PLAN_SELECT =
    "id, key, name, price_cents, price_year_cents, included_seats, seat_extra_cents, yearly_discount_mode, yearly_discount_value, description";

function assertCents(n: unknown, label: string): number {
    const v = typeof n === "number" ? n : Number(n);
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
        throw new Error(`${label}_invalid`);
    }
    return v;
}

function assertMode(m: unknown): YearlyDiscountMode {
    if (m === "percent" || m === "fixed_brl") return m;
    throw new Error("yearly_discount_mode_invalid");
}

/** Superadmin: edita lista mensal / desconto anual / seats (R3-5). */
export async function updatePlanPricing(
    admin: SupabaseClient,
    planId: string,
    input: UpdatePlanPricingInput,
    audit: PlatformOpsAuditCtx
) {
    const id = planId?.trim();
    if (!id) throw new Error("plan_id_required");

    const { data: existing, error: loadErr } = await admin
        .from("plans")
        .select(PLAN_SELECT)
        .eq("id", id)
        .maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!existing) throw new Error("plan_not_found");

    const patch: Record<string, unknown> = {};
    if (input.price_cents !== undefined) {
        patch.price_cents = assertCents(input.price_cents, "price_cents");
    }
    if (input.included_seats !== undefined) {
        const s = assertCents(input.included_seats, "included_seats");
        if (s < 1) throw new Error("included_seats_invalid");
        patch.included_seats = s;
    }
    if (input.seat_extra_cents !== undefined) {
        if (input.seat_extra_cents === null) {
            patch.seat_extra_cents = null;
        } else {
            patch.seat_extra_cents = assertCents(input.seat_extra_cents, "seat_extra_cents");
        }
    }
    if (input.yearly_discount_mode !== undefined) {
        patch.yearly_discount_mode = assertMode(input.yearly_discount_mode);
    }
    if (input.yearly_discount_value !== undefined) {
        patch.yearly_discount_value = assertCents(
            input.yearly_discount_value,
            "yearly_discount_value"
        );
    }

    const nextMonth =
        (patch.price_cents as number | undefined) ??
        (existing.price_cents as number);
    const nextMode =
        (patch.yearly_discount_mode as YearlyDiscountMode | undefined) ??
        (assertMode(existing.yearly_discount_mode ?? "percent") as YearlyDiscountMode);
    const nextDisc =
        (patch.yearly_discount_value as number | undefined) ??
        Number(existing.yearly_discount_value ?? 2000);

    const discountTouched =
        input.yearly_discount_mode !== undefined ||
        input.yearly_discount_value !== undefined ||
        input.price_cents !== undefined;

    if (discountTouched || Object.keys(patch).length > 0) {
        patch.yearly_discount_mode = nextMode;
        patch.yearly_discount_value = nextDisc;
        patch.price_year_cents = computeYearlyPriceCents(nextMonth, nextMode, nextDisc);
    }

    if (Object.keys(patch).length === 0) {
        return existing;
    }

    const { data: updated, error } = await admin
        .from("plans")
        .update(patch)
        .eq("id", id)
        .select(PLAN_SELECT)
        .single();
    if (error) throw new Error(error.message);

    await recordPlatformAudit({
        admin,
        actor: audit.actor,
        action: "platform.billing.plan_pricing_updated",
        resourceType: "plan",
        resourceId: id,
        companyId: null,
        requestId: audit.requestId,
        ipAddress: audit.ipAddress,
        userAgent: audit.userAgent,
        metadata: {
            before: {
                price_cents: existing.price_cents,
                price_year_cents: existing.price_year_cents,
                yearly_discount_mode: existing.yearly_discount_mode,
                yearly_discount_value: existing.yearly_discount_value,
                included_seats: existing.included_seats,
                seat_extra_cents: existing.seat_extra_cents,
            },
            after: patch,
            key: existing.key,
        },
    });

    return updated;
}
