"use client";

import { useEffect, useState } from "react";

type State = {
    loading: boolean;
    planKey: string | null;
    features: Set<string>;
};

/**
 * Features do plano atual (via /api/billing/status).
 * Em falha de rede: features vazias + loading false (UI decide fail-open/closed).
 */
export function usePlanFeatures(): State & { has: (key: string) => boolean } {
    const [state, setState] = useState<State>({
        loading: true,
        planKey: null,
        features: new Set(),
    });

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch("/api/billing/status", {
                    credentials: "include",
                    cache: "no-store",
                });
                const json = (await res.json().catch(() => ({}))) as {
                    plan_key?: string | null;
                    enabled_features?: string[];
                };
                if (cancelled) return;
                setState({
                    loading: false,
                    planKey: json.plan_key ?? null,
                    features: new Set(
                        Array.isArray(json.enabled_features) ? json.enabled_features : []
                    ),
                });
            } catch {
                if (!cancelled) {
                    setState({ loading: false, planKey: null, features: new Set() });
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return {
        ...state,
        has: (key: string) => state.features.has(key),
    };
}
