/**
 * Snapshot canônico de acesso do tenant (TenantAccess v2).
 * Puro — sem I/O. Fonte: docs/CHECKLIST_TENANT_ACCESS_SIGNUP_PAYMENTS.md
 */

import {
    isBillingAccessAllowed,
    resolveEffectiveBillingStatus,
    type BillingAccessStatus,
    type PagarmeSubSnapshot,
} from "@/lib/billing/resolveBillingAccess";

export type TenantAccessDecision = "allow" | "deny";

export type TenantAccess = {
    access: TenantAccessDecision;
    /** Status efetivo (mesma matriz do paywall). */
    reason: BillingAccessStatus;
    /** Plano escolhido / cobrado (mesmo sem pagar). */
    plan_intent: string | null;
    /** Se false, features do catálogo NÃO devem ser expostas. */
    featuresEligible: boolean;
};

/**
 * Resolve acesso + elegibilidade de features a partir de pagarme_subscriptions.
 * featuresEligible ≡ access allow sob gate "full".
 */
export function resolveTenantAccess(
    row: PagarmeSubSnapshot | null,
    now: Date = new Date()
): TenantAccess {
    const reason = resolveEffectiveBillingStatus(row, now);
    const allowed = isBillingAccessAllowed(reason, "full");
    const plan_intent =
        row?.plan != null && String(row.plan).trim() !== ""
            ? String(row.plan).trim()
            : null;

    return {
        access: allowed ? "allow" : "deny",
        reason,
        plan_intent,
        featuresEligible: allowed,
    };
}

/** Helper para RPC/adapters: features só se elegível. */
export function gateFeaturesByAccess<T>(
    access: TenantAccess,
    features: T[]
): T[] {
    return access.featuresEligible ? features : [];
}
