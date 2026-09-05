/**
 * Perf-4: persist seletivo do TanStack Query — só catálogo/PDV.
 * PersistQueryClientProvider completo fica para quando houver dor + pacote; P0 exporta a allowlist.
 */

export const OFFLINE_PERSIST_QUERY_KEY_PREFIXES = [
    "pdv-catalog",
    "offline-catalog",
] as const;

export function shouldPersistOfflineQuery(queryKey: unknown): boolean {
    if (!Array.isArray(queryKey) || queryKey.length === 0) return false;
    const head = queryKey[0];
    if (typeof head !== "string") return false;
    return (OFFLINE_PERSIST_QUERY_KEY_PREFIXES as readonly string[]).includes(head);
}
