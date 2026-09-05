/**
 * IDB para listas admin prefetch (P5a). Um DB, key = `${companyId}::${domain}`.
 */

import type {
    AdminListSnapshot,
    AdminListSnapshotStore,
    AdminSnapshotDomain,
} from "../ports/AdminListSnapshotStore";
import { ADMIN_SNAPSHOT_DOMAINS } from "../ports/AdminListSnapshotStore";

export const ADMIN_LIST_STALE_MS = 6 * 60 * 60 * 1000;

export const ADMIN_LIST_CAPS: Record<AdminSnapshotDomain, number> = {
    orders: 50,
    fila: 50,
    customers: 500,
    customer_addresses: 2_000,
    drivers: 200,
    printers: 50,
};

const DB_NAME = "renthus_offline_admin_lists";
const DB_VERSION = 1;
const STORE = "snapshots";

function rowKey(companyId: string, domain: AdminSnapshotDomain): string {
    return `${companyId}::${domain}`;
}

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
                db.createObjectStore(STORE, { keyPath: "key" });
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

type StoredRow = AdminListSnapshot<unknown> & { key: string };

export function createIdbAdminListSnapshotStore(): AdminListSnapshotStore {
    return {
        async save(snapshot) {
            const cap = ADMIN_LIST_CAPS[snapshot.domain];
            const entries = snapshot.entries.slice(0, cap);
            const row: StoredRow = {
                key: rowKey(snapshot.companyId, snapshot.domain),
                companyId: snapshot.companyId,
                domain: snapshot.domain,
                savedAt: snapshot.savedAt,
                version: snapshot.version,
                entryCount: entries.length,
                entries,
            };
            const db = await openDb();
            try {
                const tx = db.transaction(STORE, "readwrite");
                tx.objectStore(STORE).put(row);
                await new Promise<void>((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error ?? new Error("idb_tx_failed"));
                });
            } finally {
                db.close();
            }
        },

        async load<T>(
            companyId: string,
            domain: AdminSnapshotDomain
        ): Promise<AdminListSnapshot<T> | null> {
            const db = await openDb();
            try {
                const tx = db.transaction(STORE, "readonly");
                const row = await reqToPromise(
                    tx.objectStore(STORE).get(rowKey(companyId, domain))
                );
                if (!row) return null;
                const { key: _k, ...rest } = row as StoredRow;
                return rest as AdminListSnapshot<T>;
            } finally {
                db.close();
            }
        },

        async clear(companyId, domain) {
            const db = await openDb();
            try {
                const tx = db.transaction(STORE, "readwrite");
                const store = tx.objectStore(STORE);
                if (domain) {
                    store.delete(rowKey(companyId, domain));
                } else {
                    for (const d of ADMIN_SNAPSHOT_DOMAINS) {
                        store.delete(rowKey(companyId, d));
                    }
                }
                await new Promise<void>((resolve, reject) => {
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error ?? new Error("idb_tx_failed"));
                });
            } finally {
                db.close();
            }
        },
    };
}

export function createMemoryAdminListSnapshotStore(): AdminListSnapshotStore {
    const map = new Map<string, AdminListSnapshot<unknown>>();
    return {
        async save(snapshot) {
            const cap = ADMIN_LIST_CAPS[snapshot.domain];
            const entries = snapshot.entries.slice(0, cap);
            map.set(rowKey(snapshot.companyId, snapshot.domain), {
                ...snapshot,
                entries,
                entryCount: entries.length,
            });
        },
        async load<T>(
            companyId: string,
            domain: AdminSnapshotDomain
        ): Promise<AdminListSnapshot<T> | null> {
            const snap = map.get(rowKey(companyId, domain)) ?? null;
            return snap as AdminListSnapshot<T> | null;
        },
        async clear(companyId, domain) {
            if (domain) map.delete(rowKey(companyId, domain));
            else {
                for (const d of ADMIN_SNAPSHOT_DOMAINS) {
                    map.delete(rowKey(companyId, d));
                }
            }
        },
    };
}

export function isAdminListSnapshotStale(
    savedAt: string,
    nowMs = Date.now(),
    staleMs = ADMIN_LIST_STALE_MS
): boolean {
    const t = Date.parse(savedAt);
    if (!Number.isFinite(t)) return true;
    return nowMs - t > staleMs;
}
