/**
 * Anual de lista = (mensal × 12) − desconto (% ou R$).
 * percent: yearly_discount_value em centésimos de % (2000 = 20,00%).
 * fixed_brl: yearly_discount_value em centavos.
 */

export type YearlyDiscountMode = "percent" | "fixed_brl";

export function computeYearlyPriceCents(
    monthlyCents: number,
    mode: YearlyDiscountMode,
    discountValue: number
): number {
    const month = Math.max(0, Math.floor(monthlyCents));
    const listYear = month * 12;
    const v = Math.max(0, Math.floor(discountValue));
    let delta = 0;
    if (mode === "fixed_brl") {
        delta = v;
    } else {
        delta = Math.round((listYear * v) / 10_000);
    }
    return Math.max(0, listYear - delta);
}

/** % efetivo do anual vs 12× mensal (arredondado). Fonte de exibição do toggle. */
export function yearlySavingsPercent(monthlyCents: number, yearlyCents: number): number {
    const full = Math.max(0, Math.floor(monthlyCents)) * 12;
    const year = Math.max(0, Math.floor(yearlyCents));
    if (full <= 0 || year <= 0 || year >= full) return 0;
    return Math.round((1 - year / full) * 100);
}

/**
 * % canônico para UI: se o admin gravou `percent`, usa yearly_discount_value
 * (2000 = 20%). Se `fixed_brl`, deriva de mensal vs price_year_cents.
 */
export function yearlyDiscountLabelPercent(
    mode: YearlyDiscountMode | null | undefined,
    discountValue: number | null | undefined,
    monthlyCents: number,
    yearlyCents: number
): number {
    if (mode === "percent" && typeof discountValue === "number" && discountValue > 0) {
        return Math.round(discountValue / 100);
    }
    return yearlySavingsPercent(monthlyCents, yearlyCents);
}
