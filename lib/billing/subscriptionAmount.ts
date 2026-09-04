/**
 * Cálculo puro de cobrança mensal (lista + seats) e proration de seat.
 * Preço de lista vem do DB/catalog; promo aplica-se depois (motor separado).
 */

export type PlanPricingInput = {
    monthlyPriceCents: number;
    yearlyPriceCents: number;
    includedSeats: number;
    /** null = Essencial (sem venda de seat). */
    seatExtraCents: number | null;
};

export function computeMonthlyChargeCents(
    pricing: PlanPricingInput,
    seatQuantity: number
): number {
    const seats = Math.max(1, Math.floor(seatQuantity));
    const included = Math.max(1, Math.floor(pricing.includedSeats));
    const extras = Math.max(0, seats - included);
    const base = Math.max(0, Math.floor(pricing.monthlyPriceCents));
    if (extras === 0) return base;
    const extraUnit = pricing.seatExtraCents;
    if (extraUnit == null || extraUnit <= 0) {
        // Cap sem seat à venda: cobra só o plano (gate de invite deve bloquear extras).
        return base;
    }
    return base + extras * Math.floor(extraUnit);
}

/** Dias restantes até nextBillingAt (ceil), mínimo 1 se ainda no ciclo. */
export function daysRemainingInCycle(nextBillingAt: Date, now = new Date()): number {
    const ms = nextBillingAt.getTime() - now.getTime();
    if (ms <= 0) return 0;
    return Math.max(1, Math.ceil(ms / 86_400_000));
}

/**
 * Proration de 1 seat até o próximo vencimento do plano.
 * Denominador = 30 dias (simples, estável em sandbox/pré-prod).
 *
 * Espelho puro (spec de teste do caso mensal). A fonte canônica em runtime é a
 * RPC do banco `rpc_quote_seat_add`, que é período-aware (anual = seat×12 / 365)
 * e chama `fn_billing_prorate_cents` internamente (ADR-0006 D12 / governanca §2).
 */
export function prorateSeatExtraCents(
    seatExtraCents: number,
    nextBillingAt: Date,
    now = new Date(),
    cycleDays = 30
): number {
    const unit = Math.max(0, Math.floor(seatExtraCents));
    if (unit <= 0) return 0;
    const left = daysRemainingInCycle(nextBillingAt, now);
    if (left <= 0) return unit;
    const denom = Math.max(1, cycleDays);
    return Math.max(1, Math.round((unit * Math.min(left, denom)) / denom));
}

/** Aplica promo mensal (fixed_brl centavos ou percent em basis points). */
export function applyPromoAdjustmentCents(
    listCents: number,
    promo: {
        adjustment_kind: "discount" | "surcharge";
        adjustment_mode: "fixed_brl" | "percent";
        adjustment_value: number;
    } | null
): number {
    const base = Math.max(0, Math.floor(listCents));
    if (!promo) return base;
    const v = Math.max(0, Math.floor(promo.adjustment_value));
    let delta = 0;
    if (promo.adjustment_mode === "fixed_brl") {
        delta = v;
    } else {
        // basis points: 5000 = 50%
        delta = Math.round((base * v) / 10_000);
    }
    if (promo.adjustment_kind === "discount") {
        return Math.max(0, base - delta);
    }
    return base + delta;
}
