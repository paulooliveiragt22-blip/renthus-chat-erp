/**
 * Cache TTL in-memory para resultados de busca de catálogo (por instância).
 * Reduz RPC repetida em multi-tool / retries no mesmo worker.
 */

import type { SearchProdutosResult } from "./searchProdutos";

type Entry = { value: SearchProdutosResult; expiresAt: number };

const cache = new Map<string, Entry>();

function ttlMs(): number {
    const raw = Number(process.env.CHATBOT_CATALOG_CACHE_TTL_SEC ?? "60");
    if (!Number.isFinite(raw) || raw < 0) return 60_000;
    return Math.min(600, Math.floor(raw)) * 1000;
}

export function catalogSearchCacheKey(input: {
    companyId: string;
    query: string;
    categoryHint?: string | null;
    limit: number;
}): string {
    const q = input.query.trim().toLowerCase();
    const hint = (input.categoryHint ?? "").trim().toLowerCase();
    return `${input.companyId}|${q}|${hint}|${input.limit}`;
}

export function getCachedCatalogSearch(key: string): SearchProdutosResult | null {
    const hit = cache.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
        cache.delete(key);
        return null;
    }
    return hit.value;
}

export function setCachedCatalogSearch(key: string, value: SearchProdutosResult): void {
    const ttl = ttlMs();
    if (ttl <= 0) return;
    cache.set(key, { value, expiresAt: Date.now() + ttl });
    // Bound memory: drop oldest-ish when large
    if (cache.size > 500) {
        const first = cache.keys().next().value;
        if (first) cache.delete(first);
    }
}

export function invalidateCatalogSearchCache(companyId?: string): void {
    if (!companyId) {
        cache.clear();
        return;
    }
    const prefix = `${companyId}|`;
    for (const k of cache.keys()) {
        if (k.startsWith(prefix)) cache.delete(k);
    }
}

/** Só testes. */
export function resetCatalogSearchCacheForTests(): void {
    cache.clear();
}
