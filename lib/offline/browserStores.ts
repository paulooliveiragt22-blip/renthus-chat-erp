/**
 * Singleton browser do outbox (IDB) + helpers de sync PDV.
 */

import { createIdbOutboxStore, isIndexedDbAvailable } from "./adapters/idbOutboxStore";
import { createMemoryOutboxStore } from "./adapters/memoryOutboxStore";
import { createHttpSyncTransport } from "./adapters/httpSyncTransport";
import {
    createIdbCatalogSnapshotStore,
    createMemoryCatalogSnapshotStore,
} from "./adapters/idbCatalogSnapshotStore";
import type { OutboxStore } from "./ports/OutboxStore";
import type { CatalogSnapshotStore } from "./ports/CatalogSnapshotStore";
import { flushOutbox } from "./application/flushOutbox";
import { setSyncPendingCount, patchSyncStatus } from "./syncStatusStore";

let outbox: OutboxStore | null = null;
let catalogStore: CatalogSnapshotStore | null = null;

export function getBrowserOutboxStore(): OutboxStore {
    if (!outbox) {
        outbox = isIndexedDbAvailable() ? createIdbOutboxStore() : createMemoryOutboxStore();
    }
    return outbox;
}

export function getBrowserCatalogSnapshotStore(): CatalogSnapshotStore {
    if (!catalogStore) {
        catalogStore =
            typeof indexedDB !== "undefined"
                ? createIdbCatalogSnapshotStore()
                : createMemoryCatalogSnapshotStore();
    }
    return catalogStore;
}

export async function refreshSyncPendingBadge(companyId: string): Promise<number> {
    const n = await getBrowserOutboxStore().countPending(companyId);
    setSyncPendingCount(n);
    return n;
}

export async function flushCompanyOutbox(companyId: string): Promise<void> {
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    patchSyncStatus({ syncing: true, lastError: null });
    try {
        const result = await flushOutbox(getBrowserOutboxStore(), createHttpSyncTransport(), {
            companyId,
            batchSize: 20,
        });
        if (result.failed > 0 && !result.notImplemented) {
            patchSyncStatus({ lastError: `${result.failed} falha(s) no sync` });
        }
        if (result.notImplemented) {
            patchSyncStatus({ lastError: null });
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : "sync_error";
        patchSyncStatus({ lastError: msg });
    } finally {
        patchSyncStatus({ syncing: false });
        await refreshSyncPendingBadge(companyId);
    }
}
