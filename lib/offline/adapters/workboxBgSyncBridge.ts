/**
 * P3.4 / Perf-C: tenta Background Sync (Chrome) para acordar flush do outbox.
 * Sem custom SW handler, o tag é best-effort; wake real = online + visibility.
 */

import { flushCompanyOutbox } from "../browserStores";

export const OUTBOX_SYNC_TAG = "renthus-offline-outbox";

export function isBackgroundSyncSupported(): boolean {
    return (
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "SyncManager" in window
    );
}

/** Registra sync tag se existir SyncManager (Chrome/Edge). */
export async function requestOutboxBackgroundSync(): Promise<boolean> {
    if (!isBackgroundSyncSupported()) return false;
    try {
        const reg = await navigator.serviceWorker.ready;
        const syncManager = (
            reg as ServiceWorkerRegistration & {
                sync?: { register: (tag: string) => Promise<void> };
            }
        ).sync;
        if (!syncManager?.register) return false;
        await syncManager.register(OUTBOX_SYNC_TAG);
        return true;
    } catch {
        return false;
    }
}

/**
 * Wake unificado: BG Sync (se houver) + flush imediato se online.
 */
export async function wakeOutboxFlush(companyId: string): Promise<void> {
    await requestOutboxBackgroundSync();
    if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushCompanyOutbox(companyId);
    }
}

/** Liga listeners online/visibility uma vez por sessão. */
export function installOutboxWakeListeners(getCompanyId: () => string | null | undefined): () => void {
    const run = () => {
        const id = getCompanyId();
        if (id) void wakeOutboxFlush(id);
    };
    const onVis = () => {
        if (document.visibilityState === "visible") run();
    };
    window.addEventListener("online", run);
    document.addEventListener("visibilitychange", onVis);
    return () => {
        window.removeEventListener("online", run);
        document.removeEventListener("visibilitychange", onVis);
    };
}
