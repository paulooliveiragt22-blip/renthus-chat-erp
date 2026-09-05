import type { OfflineCommand } from "../domain/OfflineCommand";
import { getConflictPolicy, type ConflictResolution } from "../domain/ConflictPolicy";
import type { SyncCommandResult } from "../ports/SyncTransport";

/**
 * Helpers de optimistic UI (ADR-0008 D4). Call sites reais em P1/P2.
 */

export type OptimisticSnapshot<T> = {
    previous: T;
};

export function takeOptimisticSnapshot<T>(value: T): OptimisticSnapshot<T> {
    return { previous: value };
}

export function rollbackOptimistic<T>(snap: OptimisticSnapshot<T> | undefined): T | undefined {
    return snap?.previous;
}

export type ResolvedConflict = {
    resolution: ConflictResolution;
    message: string;
    commandType: string;
};

export function resolveConflict(
    command: Pick<OfflineCommand, "type">,
    result: SyncCommandResult
): ResolvedConflict {
    const resolution = getConflictPolicy(command.type);
    const message =
        result.error ??
        (resolution === "reject_reopen"
            ? "Conflito no servidor — reabra o item e tente de novo."
            : resolution === "server_wins"
              ? "Servidor prevaleceu; dados locais descartados."
              : "Conflito — ação manual necessária.");
    return { resolution, message, commandType: String(command.type) };
}
