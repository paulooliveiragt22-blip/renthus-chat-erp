/**
 * Preços de lista + IA incluso — só banco (rpc_list_commercial_plan_pricing).
 * planCatalog fica rótulo/UX, não fonte de dinheiro.
 */

import "server-only";
import type { CommercialPlanKey } from "@/lib/billing/planCatalog";
import type { YearlyDiscountMode } from "@/lib/billing/yearlyFromDiscount";

type BillingRpcClient = {
    rpc: (
        name: string,
        params: Record<string, unknown>
    ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type CommercialPlanPricingRow = {
    key: CommercialPlanKey;
    price_cents: number;
    price_year_cents: number;
    ai_included_cents: number;
    yearly_discount_mode: YearlyDiscountMode | null;
    yearly_discount_value: number | null;
};

const COMMERCIAL_KEYS = new Set<CommercialPlanKey>(["essencial", "pro", "market"]);

function asCommercialKey(raw: unknown): CommercialPlanKey | null {
    const k = String(raw ?? "");
    return COMMERCIAL_KEYS.has(k as CommercialPlanKey) ? (k as CommercialPlanKey) : null;
}

export async function loadCommercialPlanPricing(
    admin: BillingRpcClient
): Promise<Map<CommercialPlanKey, CommercialPlanPricingRow>> {
    const { data, error } = await admin.rpc("rpc_list_commercial_plan_pricing", {});
    if (error) {
        throw new Error(error.message ?? "rpc_list_commercial_plan_pricing failed");
    }
    const rows = Array.isArray(data) ? data : [];
    const map = new Map<CommercialPlanKey, CommercialPlanPricingRow>();
    for (const raw of rows) {
        const rec = raw as Record<string, unknown>;
        const key = asCommercialKey(rec.key);
        if (!key) continue;
        const price = Number(rec.price_cents);
        const year = Number(rec.price_year_cents);
        const ai = Number(rec.ai_included_cents);
        if (!Number.isFinite(price) || price <= 0) continue;
        map.set(key, {
            key,
            price_cents: Math.round(price),
            price_year_cents: Number.isFinite(year) && year > 0 ? Math.round(year) : 0,
            ai_included_cents: Number.isFinite(ai) && ai >= 0 ? Math.round(ai) : 0,
            yearly_discount_mode:
                rec.yearly_discount_mode === "percent" || rec.yearly_discount_mode === "fixed_brl"
                    ? rec.yearly_discount_mode
                    : null,
            yearly_discount_value:
                typeof rec.yearly_discount_value === "number" ? rec.yearly_discount_value : null,
        });
    }
    return map;
}

export async function loadAiIncludedBudget(
    admin: BillingRpcClient,
    companyId: string
): Promise<number> {
    const { data, error } = await admin.rpc("rpc_ai_included_budget", {
        p_company_id: companyId,
    });
    if (error) {
        throw new Error(error.message ?? "rpc_ai_included_budget failed");
    }
    const n = Number(data ?? 0);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
}
