/**
 * Política de conflito por tipo de comando (ADR-0008).
 */

export type ConflictResolution = "server_wins" | "reject_reopen" | "manual";

const DEFAULT_POLICY: ConflictResolution = "reject_reopen";

const BY_TYPE: Readonly<Record<string, ConflictResolution>> = {
    noop: "server_wins",
    FinalizePdvSale: "reject_reopen",
    UpdateOrderStatus: "server_wins",
};

export function getConflictPolicy(commandType: string): ConflictResolution {
    return BY_TYPE[commandType] ?? DEFAULT_POLICY;
}
