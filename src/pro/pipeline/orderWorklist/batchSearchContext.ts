import type { SupabaseClient } from "@supabase/supabase-js";
import {
    loadCompanySiglas,
    loadCustomerSiglaHabits,
    type CompanySigla,
    type CustomerSiglaHabit,
} from "@/src/pro/pipeline/customerPackagingHabit";

/**
 * Contexto compartilhado da busca paralela de worklist (ADR 0011 D5/D7).
 * Preload 1× de siglas; habits preenchidos após fan-out do catálogo (union product_ids).
 */
export type BatchSearchContext = {
    companySiglas: CompanySigla[];
    habitsByProductId: Map<string, CustomerSiglaHabit>;
    signal?: AbortSignal;
};

export async function createBatchSearchContext(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    signal?: AbortSignal;
}): Promise<BatchSearchContext> {
    let companySiglas: CompanySigla[] = [];
    try {
        companySiglas = await loadCompanySiglas(params.admin, params.companyId);
    } catch (err: unknown) {
        console.warn(
            "[batchSearchContext] loadCompanySiglas failed",
            err instanceof Error ? err.message : err
        );
    }
    return {
        companySiglas,
        habitsByProductId: new Map(),
        ...(params.signal ? { signal: params.signal } : {}),
    };
}

/** Após fan-out do catálogo: 1× load de hábitos para todos os product_ids. */
export async function enrichBatchSearchContextHabits(params: {
    ctx: BatchSearchContext;
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    productIds: readonly string[];
}): Promise<BatchSearchContext> {
    const ids = [...new Set(params.productIds.map((id) => String(id).trim()).filter(Boolean))];
    if (!params.customerId || !ids.length) return params.ctx;
    try {
        const habits = await loadCustomerSiglaHabits({
            admin: params.admin,
            companyId: params.companyId,
            customerId: params.customerId,
            productIds: ids,
        });
        return {
            ...params.ctx,
            habitsByProductId: habits,
        };
    } catch (err: unknown) {
        console.warn(
            "[batchSearchContext] loadCustomerSiglaHabits failed",
            err instanceof Error ? err.message : err
        );
        return params.ctx;
    }
}

export function habitSiglaForProductIds(
    ctx: BatchSearchContext,
    productIds: readonly (string | null | undefined)[]
): string | null {
    for (const raw of productIds) {
        const id = String(raw ?? "").trim();
        if (!id) continue;
        const h = ctx.habitsByProductId.get(id);
        if (h) return h;
    }
    return null;
}
