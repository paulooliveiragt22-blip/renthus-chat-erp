/**
 * Outbox durable em IndexedDB (ADR-0008 / Perf). Sem dependência extra.
 * Em ambientes sem IDB (SSR/test), use `createMemoryOutboxStore`.
 */

import type { OfflineCommand, OfflineCommandStatus } from "../domain/OfflineCommand";
import { isFlushableOfflineStatus } from "../domain/OfflineCommand";
import type { OutboxListFilter, OutboxStore } from "../ports/OutboxStore";

const DB_NAME = "renthus_offline_outbox";
const DB_VERSION = 1;
const STORE = "commands";

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("indexedDB_unavailable"));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onerror = () => reject(req.error ?? new Error("idb_open_failed"));
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const os = db.createObjectStore(STORE, { keyPath: "id" });
                os.createIndex("companyId", "companyId", { unique: false });
                os.createIndex("status", "status", { unique: false });
                os.createIndex("createdAt", "createdAt", { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
    });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("idb_request_failed"));
    });
}

export function createIdbOutboxStore(): OutboxStore {
    return {
        async enqueue(command) {
            const db = await openDb();
            try {
                const tx = db.transaction(STORE, "readwrite");
                const store = tx.objectStore(STORE);
                const existing = await reqToPromise(store.get(command.id));
                if (existing) throw new Error(`outbox_duplicate_id:${command.id}`);
                store.put(command);
                await new Promise<void>((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error ?? new Error("idb_tx_failed"));
                });
            } finally {
                db.close();
            }
        },

        async getById(id) {
            const db = await openDb();
            try {
                const tx = db.transaction(STORE, "readonly");
                const row = await reqToPromise(tx.objectStore(STORE).get(id));
                return (row as OfflineCommand | undefined) ?? null;
            } finally {
                db.close();
            }
        },

        async list(filter) {
            const db = await openDb();
            try {
                const tx = db.transaction(STORE, "readonly");
                const store = tx.objectStore(STORE);
                const all = (await reqToPromise(store.getAll())) as OfflineCommand[];
                let rows = all;
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
                return rows;
            } finally {
                db.close();
            }
        },

        async updateStatus(id, status: OfflineCommandStatus, patch) {
            const db = await openDb();
            try {
                const tx = db.transaction(STORE, "readwrite");
                const store = tx.objectStore(STORE);
                const row = (await reqToPromise(store.get(id))) as OfflineCommand | undefined;
                if (!row) throw new Error(`outbox_missing:${id}`);
                const next: OfflineCommand = {
                    ...row,
                    status,
                    attempts: patch?.attempts ?? row.attempts,
                    lastError: patch?.lastError !== undefined ? patch.lastError : row.lastError,
                    updatedAt: patch?.updatedAt ?? new Date().toISOString(),
                };
                store.put(next);
                await new Promise<void>((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error ?? new Error("idb_tx_failed"));
                });
            } finally {
                db.close();
            }
        },

        async purgeSynced(olderThanMs = 0) {
            const db = await openDb();
            try {
                const tx = db.transaction(STORE, "readwrite");
                const store = tx.objectStore(STORE);
                const all = (await reqToPromise(store.getAll())) as OfflineCommand[];
                const now = Date.now();
                let removed = 0;
                for (const row of all) {
                    if (row.status !== "synced") continue;
                    const age = now - Date.parse(row.updatedAt);
                    if (age >= olderThanMs) {
                        store.delete(row.id);
                        removed += 1;
                    }
                }
                await new Promise<void>((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error ?? new Error("idb_tx_failed"));
                });
                return removed;
            } finally {
                db.close();
            }
        },

        async countPending(companyId) {
            const rows = await this.list(
                companyId
                    ? { companyId }
                    : undefined
            );
            return rows.filter(
                (r) => isFlushableOfflineStatus(r.status) || r.status === "syncing"
            ).length;
        },
    };
}

export function isIndexedDbAvailable(): boolean {
    return typeof indexedDB !== "undefined";
}

export type { OutboxListFilter };
