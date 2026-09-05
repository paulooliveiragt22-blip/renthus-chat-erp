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

/** Tipos conhecidos; P0 allowlist vazia — mutação de negócio só após D-P1…D-P5. */
export type OfflineCommandType =
    | "noop"
    | "FinalizePdvSale"
    | "UpdateOrderStatus";

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
