/**
 * Valor exibido no checkout (/plano/pagar) — alinhado ao RPC/Pagar.me, não ao mensal de fallback.
 */

import { OFFICE_PLAN, type CommercialPlanKey } from "@/lib/billing/planCatalog";

export function resolveCheckoutDisplayAmountBrl(params: {
    planKey: CommercialPlanKey;
    billingPeriod: string | null | undefined;
    pendingInvoiceKind?: string | null;
    pendingInvoiceAmount?: number | null;
    checkoutAmountBrl?: number | null;
    monthlyPricesBrl?: Partial<Record<CommercialPlanKey, number>>;
    yearlyPricesBrl?: Partial<Record<CommercialPlanKey, number>>;
    fallbackMonthlyBrl?: number;
}): number {
    if (
        params.checkoutAmountBrl != null &&
        Number.isFinite(params.checkoutAmountBrl) &&
        params.checkoutAmountBrl > 0
    ) {
        return params.checkoutAmountBrl;
    }
    if (
        params.pendingInvoiceAmount != null &&
        Number.isFinite(params.pendingInvoiceAmount) &&
        params.pendingInvoiceAmount > 0
    ) {
        return params.pendingInvoiceAmount;
    }

    const isAnnual =
        String(params.pendingInvoiceKind ?? "").toLowerCase() === "year" ||
        String(params.billingPeriod ?? "month").toLowerCase() === "year";
    const table = isAnnual ? params.yearlyPricesBrl : params.monthlyPricesBrl;
    const fromCatalog = table?.[params.planKey];
    if (fromCatalog != null && Number.isFinite(fromCatalog) && fromCatalog > 0) {
        return fromCatalog;
    }
    return params.fallbackMonthlyBrl ?? 0;
}

/** Office não tem escada. O valor é a obrigação, senão a linha do plano. */
export function resolveOfficeCheckoutAmountBrl(params: {
    billingPeriod: string | null | undefined;
    pendingInvoiceKind?: string | null;
    pendingInvoiceAmount?: number | null;
    checkoutAmountBrl?: number | null;
}): number {
    if (
        params.checkoutAmountBrl != null &&
        Number.isFinite(params.checkoutAmountBrl) &&
        params.checkoutAmountBrl > 0
    ) {
        return params.checkoutAmountBrl;
    }
    if (
        params.pendingInvoiceAmount != null &&
        Number.isFinite(params.pendingInvoiceAmount) &&
        params.pendingInvoiceAmount > 0
    ) {
        return params.pendingInvoiceAmount;
    }
    const annual =
        String(params.pendingInvoiceKind ?? "").toLowerCase() === "year" ||
        String(params.billingPeriod ?? "month").toLowerCase() === "year";
    const cents = annual ? OFFICE_PLAN.yearlyPriceCents : OFFICE_PLAN.monthlyPriceCents;
    return cents / 100;
}
