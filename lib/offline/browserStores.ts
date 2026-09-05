/**
 * Singleton browser do outbox (IDB) + helpers de sync PDV / P5a prefetch.
 */

import { createIdbOutboxStore, isIndexedDbAvailable } from "./adapters/idbOutboxStore";
import { createMemoryOutboxStore } from "./adapters/memoryOutboxStore";
import { createHttpSyncTransport } from "./adapters/httpSyncTransport";
import {
    createIdbCatalogSnapshotStore,
    createMemoryCatalogSnapshotStore,
} from "./adapters/idbCatalogSnapshotStore";
import {
    createIdbAdminListSnapshotStore,
    createMemoryAdminListSnapshotStore,
} from "./adapters/idbAdminListSnapshotStore";
import type { OutboxStore } from "./ports/OutboxStore";
import type { CatalogSnapshotStore } from "./ports/CatalogSnapshotStore";
import type { AdminListSnapshotStore } from "./ports/AdminListSnapshotStore";
import type { AdminSnapshotDomain } from "./ports/AdminListSnapshotStore";
import { flushOutbox } from "./application/flushOutbox";
import { hydrateAdminPrefetch } from "./application/hydrateAdminPrefetch";
import { setSyncPendingCount, patchSyncStatus } from "./syncStatusStore";

let outbox: OutboxStore | null = null;
let catalogStore: CatalogSnapshotStore | null = null;
let adminListStore: AdminListSnapshotStore | null = null;
let prefetchInFlight: string | null = null;

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

export function getBrowserAdminListSnapshotStore(): AdminListSnapshotStore {
    if (!adminListStore) {
        adminListStore =
            typeof indexedDB !== "undefined"
                ? createIdbAdminListSnapshotStore()
                : createMemoryAdminListSnapshotStore();
    }
    return adminListStore;
}

export async function loadAdminListSnapshotEntries<T>(
    companyId: string,
    domain: AdminSnapshotDomain
): Promise<T[]> {
    const snap = await getBrowserAdminListSnapshotStore().load<T>(companyId, domain);
    return snap?.entries ?? [];
}

/** Prefetch P5a — no-op se offline ou já rodando para a mesma empresa. */
export async function prefetchAdminOfflineSnapshots(companyId: string): Promise<void> {
    if (!companyId) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    if (prefetchInFlight === companyId) return;
    prefetchInFlight = companyId;
    try {
        await hydrateAdminPrefetch({
            companyId,
            catalogStore: getBrowserCatalogSnapshotStore(),
            listStore: getBrowserAdminListSnapshotStore(),
        });
    } catch (e) {
        console.warn("[offline] admin prefetch failed", e);
    } finally {
        if (prefetchInFlight === companyId) prefetchInFlight = null;
    }
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
