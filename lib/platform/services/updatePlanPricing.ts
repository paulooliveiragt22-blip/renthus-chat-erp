import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { recordPlatformAudit } from "@/lib/platform/audit/recordPlatformAudit";
import type { PlatformOpsAuditCtx } from "@/lib/platform/services/platformOps";
import { defaultYearlyCentsFromMonthly } from "@/lib/billing/planCatalog";

export type UpdatePlanPricingInput = {
    price_cents?: number;
    price_year_cents?: number | null;
    included_seats?: number;
    seat_extra_cents?: number | null;
};

function assertCents(n: unknown, label: string): number {
    const v = typeof n === "number" ? n : Number(n);
    if (!Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
        throw new Error(`${label}_invalid`);
    }
    return v;
}

/** Superadmin: edita lista mensal/anual/seats (R3-5). */
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
        .select("id, key, name, price_cents, price_year_cents, included_seats, seat_extra_cents")
        .eq("id", id)
        .maybeSingle();
    if (loadErr) throw new Error(loadErr.message);
    if (!existing) throw new Error("plan_not_found");

    const patch: Record<string, unknown> = {};
    if (input.price_cents !== undefined) {
        patch.price_cents = assertCents(input.price_cents, "price_cents");
    }
    if (input.price_year_cents !== undefined) {
        if (input.price_year_cents === null) {
            patch.price_year_cents = null;
        } else {
            patch.price_year_cents = assertCents(input.price_year_cents, "price_year_cents");
        }
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

    // Se mudou mensal e não mandou anual, sugere −20% (admin ainda pode sobrescrever).
    if (patch.price_cents != null && input.price_year_cents === undefined) {
        patch.price_year_cents = defaultYearlyCentsFromMonthly(patch.price_cents as number);
    }

    if (Object.keys(patch).length === 0) {
        return existing;
    }

    const { data: updated, error } = await admin
        .from("plans")
        .update(patch)
        .eq("id", id)
        .select("id, key, name, price_cents, price_year_cents, included_seats, seat_extra_cents")
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
                included_seats: existing.included_seats,
                seat_extra_cents: existing.seat_extra_cents,
            },
            after: patch,
            key: existing.key,
        },
    });

    return updated;
}
