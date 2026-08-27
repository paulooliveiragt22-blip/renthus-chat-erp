"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

export const PLAN_FEATURES_STALE_MS = 15 * 60 * 1000;
export const PLAN_FEATURES_GC_MS = 60 * 60 * 1000;

type BillingFeaturesJson = {
    plan_key?: string | null;
    enabled_features?: string[];
    company_id?: string;
};

export type PlanFeaturesData = {
    planKey: string | null;
    features: string[];
    companyId: string;
};

function storageKey(companyId: string): string {
    return `renthusagent.planFeatures.v1.${companyId}`;
}

function readSessionCache(companyId: string): PlanFeaturesData | undefined {
    if (typeof window === "undefined") return undefined;
    try {
        const raw = sessionStorage.getItem(storageKey(companyId));
        if (!raw) return undefined;
        const parsed = JSON.parse(raw) as {
            planKey?: string | null;
            features?: string[];
            at?: number;
        };
        if (!Array.isArray(parsed.features)) return undefined;
        const at = Number(parsed.at ?? 0);
        // Sessão: no máx. 2h sem revalidar a partir do storage
        if (!Number.isFinite(at) || Date.now() - at > 2 * 60 * 60 * 1000) return undefined;
        return {
            planKey: parsed.planKey ?? null,
            features: parsed.features,
            companyId,
        };
    } catch {
        return undefined;
    }
}

function writeSessionCache(data: PlanFeaturesData): void {
    if (typeof window === "undefined") return;
    try {
        sessionStorage.setItem(
            storageKey(data.companyId),
            JSON.stringify({
                planKey: data.planKey,
                features: data.features,
                at: Date.now(),
            })
        );
    } catch {
        // quota / private mode — ignore
    }
}

export function planFeaturesQueryKey(companyId: string) {
    return ["billing", "plan-features", companyId] as const;
}

export async function fetchPlanFeatures(companyId: string): Promise<PlanFeaturesData> {
    const res = await fetch("/api/billing/features", {
        credentials: "include",
        cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as BillingFeaturesJson & { error?: string };
    if (!res.ok) {
        throw new Error(json.error ?? "billing_features_failed");
    }
    const data: PlanFeaturesData = {
        companyId: String(json.company_id ?? companyId),
        planKey: json.plan_key ?? null,
        features: Array.isArray(json.enabled_features) ? json.enabled_features : [],
    };
    writeSessionCache(data);
    return data;
}

/** Invalida cache após upgrade/troca de plano. */
export function useInvalidatePlanFeatures() {
    const qc = useQueryClient();
    const { currentCompanyId } = useWorkspace();
    return () => {
        if (!currentCompanyId) return;
        try {
            sessionStorage.removeItem(storageKey(currentCompanyId));
        } catch {
            /* ignore */
        }
        void qc.invalidateQueries({ queryKey: planFeaturesQueryKey(currentCompanyId) });
    };
}

/**
 * Prefetch no workspace (layout) — gates de tela usam o cache quente.
 */
export function usePrefetchPlanFeatures() {
    const qc = useQueryClient();
    const { currentCompanyId } = useWorkspace();

    useEffect(() => {
        if (!currentCompanyId) return;
        const cached = readSessionCache(currentCompanyId);
        if (cached) {
            qc.setQueryData(planFeaturesQueryKey(currentCompanyId), cached);
        }
        void qc.prefetchQuery({
            queryKey: planFeaturesQueryKey(currentCompanyId),
            queryFn: () => fetchPlanFeatures(currentCompanyId),
            staleTime: PLAN_FEATURES_STALE_MS,
        });
    }, [currentCompanyId, qc]);
}

/**
 * Features do plano atual (endpoint leve /api/billing/features).
 * Cache TanStack Query + sessionStorage por company_id.
 * UI: só "loading" sem dado em cache — com cache, libera na hora e revalida em background.
 */
export function usePlanFeatures(): {
    loading: boolean;
    planKey: string | null;
    features: ReadonlySet<string>;
    has: (key: string) => boolean;
} {
    const { currentCompanyId, loading: workspaceLoading } = useWorkspace();

    const { data, isPending, isError } = useQuery({
        queryKey: planFeaturesQueryKey(currentCompanyId ?? "__none__"),
        queryFn: () => fetchPlanFeatures(currentCompanyId!),
        enabled: Boolean(currentCompanyId),
        staleTime: PLAN_FEATURES_STALE_MS,
        gcTime: PLAN_FEATURES_GC_MS,
        refetchOnWindowFocus: false,
        // Com initialData/cache: não fica isPending; revalida em background se stale.
        retry: 1,
        initialData: () =>
            currentCompanyId ? readSessionCache(currentCompanyId) : undefined,
        initialDataUpdatedAt: () => {
            if (!currentCompanyId) return 0;
            return readSessionCache(currentCompanyId) ? Date.now() : 0;
        },
    });

    const featureList = data?.features ?? [];
    const featureSet = new Set(featureList);
    /**
     * Enquanto o workspace resolve `companyId` OU o fetch de features ainda não
     * trouxe dado, a UI deve tratar como "loading" (fail-open no menu).
     * Bug antigo: `loading` era false quando `currentCompanyId` ainda era null,
     * então o sidebar filtrava com Set vazio e as abas gated só apareciam depois
     * (parecia "demora pra carregar todas as abas").
     */
    const loading =
        workspaceLoading ||
        (Boolean(currentCompanyId) && !data && isPending && !isError);

    return {
        loading,
        planKey: data?.planKey ?? null,
        features: featureSet,
        has: (key: string) => featureSet.has(key),
    };
}
