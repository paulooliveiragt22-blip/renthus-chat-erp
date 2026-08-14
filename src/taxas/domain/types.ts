/** Conta 3.3 — taxas de serviço (não-entrega). */

export const SERVICE_FEE_ACCOUNT_ID = "00000000-0001-0000-0000-000000000303";
export const SERVICE_FEE_ACCOUNT_CODE = "3.3";

export type ServiceFeeSystemKey = "delivery" | "service" | "other";
export type ServiceFeeCalcMode = "fixed" | "percent";

export type ServiceFeeDefinition = {
    id: string;
    company_id: string;
    name: string;
    slug: string;
    system_key: ServiceFeeSystemKey | null;
    calc_mode: ServiceFeeCalcMode;
    value: number;
    is_active: boolean;
    sort_order: number;
};

export type OrderFeeLine = {
    id: string;
    name: string;
    system_key: ServiceFeeSystemKey | null;
    calc_mode: ServiceFeeCalcMode;
    rate_or_amount: number;
    amount: number;
    definition_id?: string | null;
};

export type UpsertServiceFeePayload = {
    id?: string;
    name: string;
    slug?: string;
    system_key?: ServiceFeeSystemKey | null;
    calc_mode: ServiceFeeCalcMode;
    value: number;
    is_active?: boolean;
    sort_order?: number;
};

export type ApplyOrderFeeInput = {
    definition_id?: string;
    name?: string;
    system_key?: ServiceFeeSystemKey | null;
    calc_mode?: ServiceFeeCalcMode;
    rate_or_amount?: number;
    value?: number;
};

/** % sobre subtotal de itens; fixed = R$. */
export function computeFeeAmount(
    mode: ServiceFeeCalcMode,
    rateOrAmount: number,
    itemsSubtotal: number
): number {
    const rate = Number.isFinite(rateOrAmount) ? Math.max(0, rateOrAmount) : 0;
    if (mode === "percent") {
        return Math.round(itemsSubtotal * (rate / 100) * 100) / 100;
    }
    return Math.round(rate * 100) / 100;
}
