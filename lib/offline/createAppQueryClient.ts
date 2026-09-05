import { QueryClient } from "@tanstack/react-query";
import { shouldPersistOfflineQuery } from "./persistQueryAllowlist";

/**
 * QueryClient do app com defaults offline-ready (ADR-0008 P0.10 / Perf-4).
 * Persist parcial: use `shouldPersistOfflineQuery` ao ligar PersistQueryClientProvider (P1+).
 */
export function createAppQueryClient(): QueryClient {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 30 * 1000,
                retry: 1,
                networkMode: "online",
            },
            mutations: {
                networkMode: "online",
            },
        },
    });
}

export { shouldPersistOfflineQuery };
