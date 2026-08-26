"use client";

import { useQuery } from "@tanstack/react-query";

type BillingStatusJson = {
    plan_key?: string | null;
    enabled_features?: string[];
};

type PlanFeaturesData = {
    planKey: string | null;
    features: Set<string>;
};

async function fetchPlanFeatures(): Promise<PlanFeaturesData> {
    const res = await fetch("/api/billing/status", {
        credentials: "include",
        cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as BillingStatusJson;
    return {
        planKey: json.plan_key ?? null,
        features: new Set(Array.isArray(json.enabled_features) ? json.enabled_features : []),
    };
}

/**
 * Features do plano atual (via /api/billing/status).
 * Cache compartilhado via TanStack Query — uma chamada por sessão/staleTime
 * mesmo com vários consumidores (sidebar, PDV, gates).
 */
export function usePlanFeatures(): {
    loading: boolean;
    planKey: string | null;
    features: Set<string>;
    has: (key: string) => boolean;
} {
    const { data, isPending, isFetching } = useQuery({
        queryKey: ["billing", "plan-features"],
        queryFn: fetchPlanFeatures,
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
    });

    const features = data?.features ?? new Set<string>();
    const loading = isPending || (isFetching && !data);

    return {
        loading,
        planKey: data?.planKey ?? null,
        features,
        has: (key: string) => features.has(key),
    };
}
