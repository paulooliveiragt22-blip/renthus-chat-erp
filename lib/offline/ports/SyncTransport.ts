import type { OfflineCommand } from "../domain/OfflineCommand";

export type SyncCommandResult = {
    clientMutationId: string;
    outcome: "synced" | "failed" | "conflict";
    error?: string;
    serverPayload?: Record<string, unknown>;
};

export type SyncBatchRequest = {
    companyId: string;
    commands: OfflineCommand[];
};

export type SyncBatchResponse = {
    results: SyncCommandResult[];
    /** true quando a API ainda não aplica mutação (P0 stub). */
    notImplemented?: boolean;
};

export type SyncTransport = {
    sendBatch(request: SyncBatchRequest, signal?: AbortSignal): Promise<SyncBatchResponse>;
};

/** Perf-3: teto padrão de cmds por request. */
export const DEFAULT_FLUSH_BATCH_SIZE = 20;
