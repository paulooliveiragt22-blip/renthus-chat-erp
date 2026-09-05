"use client";

/**
 * Skeleton da ponte TanStack ↔ outbox (ADR-0008 P0.9).
 * Sem call sites de negócio em P0 — documenta onMutate / onError / rollback.
 */

import {
    useMutation,
    type UseMutationOptions,
    type UseMutationResult,
} from "@tanstack/react-query";
import {
    rollbackOptimistic,
    takeOptimisticSnapshot,
    type OptimisticSnapshot,
} from "../application/applyOptimistic";

export type OfflineMutationContext<TData = unknown> = {
    optimistic?: OptimisticSnapshot<TData>;
};

/**
 * Wrapper fino sobre `useMutation`: preserva callbacks do caller e documenta
 * o contrato de snapshot/rollback. Enfileiramento no outbox entra em P1.
 */
export function useOfflineMutation<
    TData = unknown,
    TError = Error,
    TVariables = void,
    TContext = OfflineMutationContext,
>(
    options: UseMutationOptions<TData, TError, TVariables, TContext>
): UseMutationResult<TData, TError, TVariables, TContext> {
    return useMutation(options);
}

export { takeOptimisticSnapshot, rollbackOptimistic };
