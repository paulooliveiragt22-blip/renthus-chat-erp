/**
 * Contrato de comando local (ADR-0008). Fonte da verdade no browser até ACK do servidor.
 */

export const OFFLINE_COMMAND_STATUSES = [
    "pending",
    "syncing",
    "synced",
    "failed",
    "conflict",
] as const;

export type OfflineCommandStatus = (typeof OFFLINE_COMMAND_STATUSES)[number];

/**
 * Tipos conhecidos (ADR-0008 D-P6).
 * Allowlist efetiva em SyncEligibility cresce por onda P5a→P5e — tipo aqui ≠ já enfileirável.
 */
export type OfflineCommandType =
    | "noop"
    | "FinalizePdvSale"
    | "UpdateOrderStatus"
    | "CreateOrder" // M1 — P5c
    | "AdjustStock" // M4 — P5d
    | "UpsertCustomer" // M5 — P5d
    | "AssignDriver" // M6 — P5b
    | "QueueClaim" // M7 — P5e
    | "ReprintJob" // M8 — P5e
    | "UpsertProduct" // M9 — P5d
    | "UpdateOrderStatusExtended"; // M3 — P5b (ou amplia UpdateOrderStatus)

export type OfflineCommand = {
    id: string;
    type: OfflineCommandType | (string & {});
    companyId: string;
    payload: Record<string, unknown>;
    clientMutationId: string;
    status: OfflineCommandStatus;
    createdAt: string;
    updatedAt: string;
    attempts: number;
    lastError: string | null;
};

export type NewOfflineCommandInput = {
    type: OfflineCommand["type"];
    companyId: string;
    payload?: Record<string, unknown>;
    clientMutationId?: string;
    id?: string;
};

export function isTerminalOfflineStatus(status: OfflineCommandStatus): boolean {
    return status === "synced" || status === "failed" || status === "conflict";
}

export function isFlushableOfflineStatus(status: OfflineCommandStatus): boolean {
    return status === "pending" || status === "failed";
}

export function createOfflineCommand(input: NewOfflineCommandInput): OfflineCommand {
    const now = new Date().toISOString();
    const id =
        input.id ??
        (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
    const clientMutationId =
        input.clientMutationId ??
        (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `mut_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);

    return {
        id,
        type: input.type,
        companyId: input.companyId,
        payload: input.payload ?? {},
        clientMutationId,
        status: "pending",
        createdAt: now,
        updatedAt: now,
        attempts: 0,
        lastError: null,
    };
}
