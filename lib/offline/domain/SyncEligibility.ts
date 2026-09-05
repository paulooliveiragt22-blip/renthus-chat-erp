/**
 * Quem pode entrar na fila offline (ADR-0008 D2 / D-P3 / Perf).
 * P0: allowlist vazia (exceto `noop` para testes secos).
 */

import type { OfflineCommand, OfflineCommandType } from "./OfflineCommand";

/** Tipos permitidos — P1 finalize + P2 status leve + noop. */
export const OFFLINE_COMMAND_ALLOWLIST: ReadonlySet<string> = new Set<OfflineCommandType | string>([
    "noop",
    "FinalizePdvSale",
    "UpdateOrderStatus",
    "CreateOrder",
]);

/** Status de pedido permitidos offline (P2 — sem finalize/cancel financeiros). */
export const OFFLINE_ORDER_STATUS_ALLOWLIST: ReadonlySet<string> = new Set([
    "preparing",
    "delivered",
]);

export function isOfflineOrderStatusAllowed(status: string): boolean {
    return OFFLINE_ORDER_STATUS_ALLOWLIST.has(String(status).trim().toLowerCase());
}

/** Defaults sugeridos no ADR (confirmar owner em D-P3). */
export const DEFAULT_MAX_PENDING_COMMANDS = 200;
export const DEFAULT_MAX_COMMAND_AGE_MS = 24 * 60 * 60 * 1000;

export type SyncEligibilityLimits = {
    maxPendingCommands: number;
    maxCommandAgeMs: number;
};

export type SyncEligibilityResult =
    | { ok: true }
    | { ok: false; reason: "type_not_allowed" | "queue_full" | "command_too_old" | "invalid_company" };

export function getDefaultSyncEligibilityLimits(): SyncEligibilityLimits {
    return {
        maxPendingCommands: DEFAULT_MAX_PENDING_COMMANDS,
        maxCommandAgeMs: DEFAULT_MAX_COMMAND_AGE_MS,
    };
}

export function isCommandTypeAllowed(type: string): boolean {
    return OFFLINE_COMMAND_ALLOWLIST.has(type);
}

/**
 * Valida se um comando pode ser enfileirado.
 * `pendingCount` = comandos ainda não terminais (pending/syncing/failed retryáveis).
 */
export function canEnqueueCommand(
    command: Pick<OfflineCommand, "type" | "companyId" | "createdAt">,
    pendingCount: number,
    limits: SyncEligibilityLimits = getDefaultSyncEligibilityLimits(),
    nowMs: number = Date.now()
): SyncEligibilityResult {
    if (!command.companyId.trim()) {
        return { ok: false, reason: "invalid_company" };
    }
    if (!isCommandTypeAllowed(command.type)) {
        return { ok: false, reason: "type_not_allowed" };
    }
    if (pendingCount >= limits.maxPendingCommands) {
        return { ok: false, reason: "queue_full" };
    }
    const created = Date.parse(command.createdAt);
    if (Number.isFinite(created) && nowMs - created > limits.maxCommandAgeMs) {
        return { ok: false, reason: "command_too_old" };
    }
    return { ok: true };
}
