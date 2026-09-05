import type { OfflineCommand, OfflineCommandStatus } from "../domain/OfflineCommand";

export type OutboxListFilter = {
    companyId?: string;
    statuses?: OfflineCommandStatus[];
    limit?: number;
};

export type OutboxStore = {
    enqueue(command: OfflineCommand): Promise<void>;
    getById(id: string): Promise<OfflineCommand | null>;
    list(filter?: OutboxListFilter): Promise<OfflineCommand[]>;
    updateStatus(
        id: string,
        status: OfflineCommandStatus,
        patch?: Partial<Pick<OfflineCommand, "attempts" | "lastError" | "updatedAt">>
    ): Promise<void>;
    purgeSynced(olderThanMs?: number): Promise<number>;
    countPending(companyId?: string): Promise<number>;
};
