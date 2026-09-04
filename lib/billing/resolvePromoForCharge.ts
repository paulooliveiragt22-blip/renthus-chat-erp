/**
 * Promo mensal (R3-1/R2): resolve campanha ativa ou snapshot na subscription.
 */

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { applyPromoAdjustmentCents } from "@/lib/billing/subscriptionAmount";

export type PromoRule = {
    id: string;
    adjustment_kind: "discount" | "surcharge";
    adjustment_mode: "fixed_brl" | "percent";
    adjustment_value: number;
    duration_months: number;
};

export type PromoSnapshot = {
    promo_id: string;
    adjustment_kind: "discount" | "surcharge";
    adjustment_mode: "fixed_brl" | "percent";
    adjustment_value: number;
    duration_months: number;
    attached_at: string;
};

function asRule(row: Record<string, unknown>): PromoRule | null {
    const id = typeof row.id === "string" ? row.id : null;
    const kind = row.adjustment_kind;
    const mode = row.adjustment_mode;
    const value = Number(row.adjustment_value);
    const duration = Number(row.duration_months);
    if (
        !id ||
        (kind !== "discount" && kind !== "surcharge") ||
        (mode !== "fixed_brl" && mode !== "percent") ||
        !Number.isFinite(value) ||
        !Number.isFinite(duration) ||
        duration < 1
    ) {
        return null;
    }
    return {
        id,
        adjustment_kind: kind,
        adjustment_mode: mode,
        adjustment_value: Math.floor(value),
        duration_months: Math.floor(duration),
    };
}

/** Campanha ativa agora para o plan_id (adesão). Anual não usa (R3-2). */
export async function findActivePlanPromotion(
    admin: SupabaseClient,
    planId: string | null,
    now = new Date()
): Promise<PromoRule | null> {
    if (!planId) return null;
    const iso = now.toISOString();
    const { data, error } = await admin
        .from("plan_promotions")
        .select(
            "id, adjustment_kind, adjustment_mode, adjustment_value, duration_months, starts_at, ends_at, active"
        )
        .eq("plan_id", planId)
        .eq("active", true)
        .lte("starts_at", iso)
        .gte("ends_at", iso)
        .order("starts_at", { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error || !data) return null;
    return asRule(data as Record<string, unknown>);
}

export function snapshotFromRule(rule: PromoRule, now = new Date()): PromoSnapshot {
    return {
        promo_id: rule.id,
        adjustment_kind: rule.adjustment_kind,
        adjustment_mode: rule.adjustment_mode,
        adjustment_value: rule.adjustment_value,
        duration_months: rule.duration_months,
        attached_at: now.toISOString(),
    };
}

export function ruleFromSnapshot(snap: unknown): PromoRule | null {
    if (!snap || typeof snap !== "object") return null;
    const s = snap as Record<string, unknown>;
    return asRule({
        id: s.promo_id ?? s.id,
        adjustment_kind: s.adjustment_kind,
        adjustment_mode: s.adjustment_mode,
        adjustment_value: s.adjustment_value,
        duration_months: s.duration_months,
    });
}

/**
 * Preço mensal após promo do tenant (só se months remaining > 0).
 * Lista = charge antes de promo (já com seats).
 */
export function applyTenantPromoCents(
    listWithSeatsCents: number,
    opts: {
        billingPeriod?: string | null;
        promoMonthsRemaining?: number | null;
        promoSnapshot?: unknown;
    }
): { amountCents: number; promoApplied: boolean } {
    if (String(opts.billingPeriod ?? "month") === "year") {
        return { amountCents: listWithSeatsCents, promoApplied: false };
    }
    const months = opts.promoMonthsRemaining;
    if (typeof months !== "number" || months <= 0) {
        return { amountCents: listWithSeatsCents, promoApplied: false };
    }
    const rule = ruleFromSnapshot(opts.promoSnapshot);
    if (!rule) return { amountCents: listWithSeatsCents, promoApplied: false };
    return {
        amountCents: applyPromoAdjustmentCents(listWithSeatsCents, rule),
        promoApplied: true,
    };
}
