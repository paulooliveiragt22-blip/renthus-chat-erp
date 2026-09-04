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
