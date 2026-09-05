/**
 * Snapshot reativo do estado de sync (useSyncExternalStore).
 * Neutro de UI — presentation só consome.
 */

export type SyncStatusSnapshot = {
    online: boolean;
    pendingCount: number;
    syncing: boolean;
    lastError: string | null;
    catalogStale: boolean;
};

const listeners = new Set<() => void>();

let snapshot: SyncStatusSnapshot = {
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    pendingCount: 0,
    syncing: false,
    lastError: null,
    catalogStale: false,
};

export function getSyncStatusSnapshot(): SyncStatusSnapshot {
    return snapshot;
}

export function subscribeSyncStatus(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

function emit() {
    for (const l of listeners) l();
}

export function patchSyncStatus(patch: Partial<SyncStatusSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    emit();
}

/** Chamado após enqueue/flush; listeners podem reconsultar o outbox. */
export function notifySyncStatusChanged(): void {
    emit();
}

export function setSyncPendingCount(pendingCount: number): void {
    patchSyncStatus({ pendingCount });
}

export function setSyncOnline(online: boolean): void {
    patchSyncStatus({ online });
}
