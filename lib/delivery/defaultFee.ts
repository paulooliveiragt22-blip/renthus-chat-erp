/** Snapshot mínimo da definição canônica (system_key=delivery). */
export type DeliveryFeeDefinitionSnapshot = {
    is_active: boolean;
    calc_mode: "fixed" | "percent";
    value: number;
};

/**
 * Valor BRL base para cotação / default de pedido.
 * Só aplica quando a definição está ativa e em modo fixed.
 * Percentual depende do subtotal e é resolvido no pedido / order_fees.
 */
export function deliveryBaseFeeAmount(
    def: DeliveryFeeDefinitionSnapshot | null | undefined
): number {
    if (!def?.is_active) return 0;
    if (def.calc_mode !== "fixed") return 0;
    const n = Number(def.value ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
}

export function pickDeliveryFeeDefinition<
    T extends { system_key?: string | null },
>(defs: T[] | null | undefined): T | null {
    if (!defs?.length) return null;
    return defs.find((d) => d.system_key === "delivery") ?? null;
}
