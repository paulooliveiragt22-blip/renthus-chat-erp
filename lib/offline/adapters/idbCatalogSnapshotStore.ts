/**
 * Snapshot de catálogo PDV (Perf-1). Projection enxuta + teto.
 */

import type {
    CatalogSnapshot,
    CatalogSnapshotEntry,
    CatalogSnapshotStore,
} from "../ports/CatalogSnapshotStore";

export const CATALOG_SNAPSHOT_MAX_ENTRIES = 5_000;
export const CATALOG_SNAPSHOT_STALE_MS = 6 * 60 * 60 * 1000; // 6h → badge

const DB_NAME = "renthus_offline_catalog";
const DB_VERSION = 1;
const STORE = "snapshots";

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
                db.createObjectStore(STORE, { keyPath: "companyId" });
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

/** Corta e projeta entradas (Perf-1). */
export function projectCatalogEntries(
    rows: CatalogSnapshotEntry[],
    max = CATALOG_SNAPSHOT_MAX_ENTRIES
): CatalogSnapshotEntry[] {
    return rows.slice(0, max).map((e) => ({
        productId: e.productId,
        embalagemId: e.embalagemId,
        name: e.name,
        precoVenda: Number(e.precoVenda) || 0,
        sigla: e.sigla,
        fatorConversao: Math.max(1, Number(e.fatorConversao) || 1),
        ean: e.ean,
        codigoInterno: e.codigoInterno,
        codigoInternoEmbalagem: e.codigoInternoEmbalagem,
        venderComEstoqueZero: e.venderComEstoqueZero !== false,
        categoryName: e.categoryName ?? null,
        details: e.details ?? null,
        siglaHumanizada: e.siglaHumanizada ?? null,
        volumeFormatado: e.volumeFormatado ?? null,
        salesCount: Number(e.salesCount) || 0,
    }));
}

export function createIdbCatalogSnapshotStore(): CatalogSnapshotStore {
    return {
        async save(snapshot) {
            const entries = projectCatalogEntries(snapshot.entries);
            const row: CatalogSnapshot = {
                ...snapshot,
                entries,
                entryCount: entries.length,
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

        async load(companyId) {
            const db = await openDb();
            try {
                const tx = db.transaction(STORE, "readonly");
                const row = await reqToPromise(tx.objectStore(STORE).get(companyId));
                return (row as CatalogSnapshot | undefined) ?? null;
            } finally {
                db.close();
            }
        },

        async clear(companyId) {
            const db = await openDb();
            try {
                const tx = db.transaction(STORE, "readwrite");
                tx.objectStore(STORE).delete(companyId);
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

export function createMemoryCatalogSnapshotStore(): CatalogSnapshotStore {
    const byCompany = new Map<string, CatalogSnapshot>();
    return {
        async save(snapshot) {
            const entries = projectCatalogEntries(snapshot.entries);
            byCompany.set(snapshot.companyId, {
                ...snapshot,
                entries,
                entryCount: entries.length,
            });
        },
        async load(companyId) {
            return byCompany.get(companyId) ?? null;
        },
        async clear(companyId) {
            byCompany.delete(companyId);
        },
    };
}

export function isCatalogSnapshotStale(
    savedAt: string,
    nowMs = Date.now(),
    staleMs = CATALOG_SNAPSHOT_STALE_MS
): boolean {
    const t = Date.parse(savedAt);
    if (!Number.isFinite(t)) return true;
    return nowMs - t > staleMs;
}
