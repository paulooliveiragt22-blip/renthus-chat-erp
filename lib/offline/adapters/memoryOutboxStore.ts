import type { OfflineCommand, OfflineCommandStatus } from "../domain/OfflineCommand";
import { isFlushableOfflineStatus } from "../domain/OfflineCommand";
import type { OutboxListFilter, OutboxStore } from "../ports/OutboxStore";

/**
 * Outbox em memória — testes e SSR. Não é durable entre reloads.
 */
export function createMemoryOutboxStore(): OutboxStore {
    const byId = new Map<string, OfflineCommand>();

    return {
        async enqueue(command) {
            if (byId.has(command.id)) {
                throw new Error(`outbox_duplicate_id:${command.id}`);
            }
            byId.set(command.id, { ...command });
        },

        async getById(id) {
            const row = byId.get(id);
            return row ? { ...row } : null;
        },

        async list(filter) {
            let rows = [...byId.values()];
            if (filter?.companyId) {
                rows = rows.filter((r) => r.companyId === filter.companyId);
            }
            if (filter?.statuses?.length) {
                const set = new Set(filter.statuses);
                rows = rows.filter((r) => set.has(r.status));
            }
            rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
            if (filter?.limit != null && filter.limit >= 0) {
                rows = rows.slice(0, filter.limit);
            }
            return rows.map((r) => ({ ...r }));
        },

        async updateStatus(id, status, patch) {
            const row = byId.get(id);
            if (!row) throw new Error(`outbox_missing:${id}`);
            byId.set(id, {
                ...row,
                status,
                attempts: patch?.attempts ?? row.attempts,
                lastError: patch?.lastError !== undefined ? patch.lastError : row.lastError,
                updatedAt: patch?.updatedAt ?? new Date().toISOString(),
            });
        },

        async purgeSynced(olderThanMs = 0) {
            const now = Date.now();
            let removed = 0;
            for (const [id, row] of byId) {
                if (row.status !== "synced") continue;
                const age = now - Date.parse(row.updatedAt);
                if (age >= olderThanMs) {
                    byId.delete(id);
                    removed += 1;
                }
            }
            return removed;
        },

        async countPending(companyId) {
            let n = 0;
            for (const row of byId.values()) {
                if (companyId && row.companyId !== companyId) continue;
                if (isFlushableOfflineStatus(row.status) || row.status === "syncing") n += 1;
            }
            return n;
        },
    };
}

export type { OfflineCommandStatus };
