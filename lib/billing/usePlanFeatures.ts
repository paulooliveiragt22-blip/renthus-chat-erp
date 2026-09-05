"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { useWorkspace } from "@/lib/workspace/useWorkspace";

export const PLAN_FEATURES_STALE_MS = 15 * 60 * 1000;
export const PLAN_FEATURES_GC_MS = 60 * 60 * 1000;
/** Cache durável (localStorage) — sobrevive reload / reopen da PWA offline. */
export const PLAN_FEATURES_LOCAL_TTL_MS = 48 * 60 * 60 * 1000;

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

type StoredBlob = {
    planKey?: string | null;
    features?: string[];
    at?: number;
};

function parseStored(companyId: string, raw: string | null, maxAgeMs: number): PlanFeaturesData | undefined {
    if (!raw) return undefined;
    try {
        const parsed = JSON.parse(raw) as StoredBlob;
        if (!Array.isArray(parsed.features)) return undefined;
        const at = Number(parsed.at ?? 0);
        if (!Number.isFinite(at) || Date.now() - at > maxAgeMs) return undefined;
        return {
            planKey: parsed.planKey ?? null,
            features: parsed.features,
            companyId,
        };
    } catch {
        return undefined;
    }
}

/** Last-known entitlements: localStorage (PWA reload) + migrate de sessionStorage. */
function readDurableCache(companyId: string): PlanFeaturesData | undefined {
    if (typeof window === "undefined") return undefined;
    try {
        const fromLocal = parseStored(
            companyId,
            localStorage.getItem(storageKey(companyId)),
            PLAN_FEATURES_LOCAL_TTL_MS
        );
        if (fromLocal) return fromLocal;

        const fromSession = parseStored(
            companyId,
            sessionStorage.getItem(storageKey(companyId)),
            PLAN_FEATURES_LOCAL_TTL_MS
        );
        if (fromSession) {
            writeDurableCache(fromSession);
            try {
                sessionStorage.removeItem(storageKey(companyId));
            } catch {
                /* ignore */
            }
            return fromSession;
        }
    } catch {
        /* private mode */
    }
    return undefined;
}

function writeDurableCache(data: PlanFeaturesData): void {
    if (typeof window === "undefined") return;
    const payload = JSON.stringify({
        planKey: data.planKey,
        features: data.features,
        at: Date.now(),
    });
    try {
        localStorage.setItem(storageKey(data.companyId), payload);
    } catch {
        /* quota / private mode */
    }
    try {
        sessionStorage.setItem(storageKey(data.companyId), payload);
    } catch {
        /* ignore */
    }
}

function clearDurableCache(companyId: string): void {
    if (typeof window === "undefined") return;
    try {
        localStorage.removeItem(storageKey(companyId));
    } catch {
        /* ignore */
    }
    try {
        sessionStorage.removeItem(storageKey(companyId));
    } catch {
        /* ignore */
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
    writeDurableCache(data);
    return data;
}

/** Invalida cache após upgrade/troca de plano. */
export function useInvalidatePlanFeatures() {
    const qc = useQueryClient();
    const { currentCompanyId } = useWorkspace();
    return useCallback(() => {
        if (!currentCompanyId) return;
        clearDurableCache(currentCompanyId);
        void qc.invalidateQueries({ queryKey: planFeaturesQueryKey(currentCompanyId) });
    }, [qc, currentCompanyId]);
}

/**
 * Prefetch no workspace (layout) — gates de tela usam o cache quente.
 */
export function usePrefetchPlanFeatures() {
    const qc = useQueryClient();
    const { currentCompanyId } = useWorkspace();

    useEffect(() => {
        if (!currentCompanyId) return;
        const cached = readDurableCache(currentCompanyId);
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
 * Cache TanStack Query + localStorage por company_id (sobrevive reload PWA offline).
 */
export function usePlanFeatures(): {
    loading: boolean;
    /** Sem last-known e sem rede — não confundir com “plano sem feature”. */
    unavailable: boolean;
    planKey: string | null;
    features: ReadonlySet<string>;
    has: (key: string) => boolean;
} {
    const { currentCompanyId, loading: workspaceLoading } = useWorkspace();
    const browserOffline =
        typeof navigator !== "undefined" && navigator.onLine === false;

    const { data, isPending, isError, fetchStatus } = useQuery({
        queryKey: planFeaturesQueryKey(currentCompanyId ?? "__none__"),
        queryFn: () => fetchPlanFeatures(currentCompanyId!),
        enabled: Boolean(currentCompanyId),
        staleTime: PLAN_FEATURES_STALE_MS,
        gcTime: PLAN_FEATURES_GC_MS,
        refetchOnWindowFocus: false,
        retry: 1,
        initialData: () =>
            currentCompanyId ? readDurableCache(currentCompanyId) : undefined,
        initialDataUpdatedAt: () => {
            if (!currentCompanyId) return 0;
            return readDurableCache(currentCompanyId) ? Date.now() : 0;
        },
    });

    const featureList = data?.features ?? [];
    const featureSet = new Set(featureList);
    const hasData = Boolean(data && Array.isArray(data.features));

    /**
     * Offline + Query paused sem dado: não ficar em “Verificando plano…” eterno
     * (networkMode online do QueryClient).
     */
    const pausedOffline = fetchStatus === "paused" || browserOffline;
    const loading =
        workspaceLoading ||
        (Boolean(currentCompanyId) &&
            !hasData &&
            isPending &&
            !isError &&
            !pausedOffline);

    const unavailable =
        Boolean(currentCompanyId) &&
        !hasData &&
        !loading &&
        (isError || pausedOffline);

    return {
        loading,
        unavailable,
        planKey: data?.planKey ?? null,
        features: featureSet,
        has: (key: string) => featureSet.has(key),
    };
}
