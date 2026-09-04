/**
 * Proration de upgrade de plano (BN-11).
 * Delta = (mensal_destino − mensal_atual) × dias_restantes / 30.
 */

import { daysRemainingInCycle } from "@/lib/billing/subscriptionAmount";

export function proratePlanUpgradeCents(
    fromMonthlyCents: number,
    toMonthlyCents: number,
    nextBillingAt: Date,
    now = new Date(),
    cycleDays = 30
): number {
    const from = Math.max(0, Math.floor(fromMonthlyCents));
    const to = Math.max(0, Math.floor(toMonthlyCents));
    const delta = to - from;
    if (delta <= 0) return 0;
    const left = daysRemainingInCycle(nextBillingAt, now);
    if (left <= 0) return delta;
    const denom = Math.max(1, cycleDays);
    return Math.max(1, Math.round((delta * Math.min(left, denom)) / denom));
}
