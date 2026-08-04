/** Intervalo permitido para sync automático de catálogo (horas). */
export const CATALOG_SYNC_INTERVAL_MIN = 1;
export const CATALOG_SYNC_INTERVAL_MAX = 6;
export const CATALOG_SYNC_INTERVAL_DEFAULT = 3;

export function clampCatalogSyncIntervalHours(value: unknown): number {
    if (value == null || value === "") return CATALOG_SYNC_INTERVAL_DEFAULT;
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return CATALOG_SYNC_INTERVAL_DEFAULT;
    return Math.min(
        CATALOG_SYNC_INTERVAL_MAX,
        Math.max(CATALOG_SYNC_INTERVAL_MIN, n)
    );
}

/** True se nunca sincronizou ou se já passou o intervalo desde lastSyncAt. */
export function isCatalogSyncDue(params: {
    lastSyncAt: string | null | undefined;
    intervalHours: number;
    now?: Date;
}): boolean {
    const intervalHours = clampCatalogSyncIntervalHours(params.intervalHours);
    if (!params.lastSyncAt) return true;
    const last = Date.parse(params.lastSyncAt);
    if (!Number.isFinite(last)) return true;
    const nowMs = (params.now ?? new Date()).getTime();
    const elapsedMs = nowMs - last;
    return elapsedMs >= intervalHours * 60 * 60 * 1000;
}
