/**
 * Cache TTL para busca de catálogo — memória local + Upstash quando configurado.
 */

import { Redis } from "@upstash/redis";
import type { SearchProdutosResult } from "./searchProdutos";

type Entry = { value: SearchProdutosResult; expiresAt: number };

const cache = new Map<string, Entry>();

function ttlMs(): number {
    const raw = Number(process.env.CHATBOT_CATALOG_CACHE_TTL_SEC ?? "60");
    if (!Number.isFinite(raw) || raw < 0) return 60_000;
    return Math.min(600, Math.floor(raw)) * 1000;
}

function ttlSec(): number {
    return Math.max(1, Math.ceil(ttlMs() / 1000));
}

function redisOrNull(): Redis | null {
    if (
        !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
        !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
    ) {
        return null;
    }
    return Redis.fromEnv();
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

function redisKey(key: string): string {
    return `renthus:catalog:${key}`;
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
    if (cache.size > 500) {
        const first = cache.keys().next().value;
        if (first) cache.delete(first);
    }
}

/** Memória + Redis (fail-open). Preferir no hot path serverless. */
export async function getCachedCatalogSearchAsync(
    key: string
): Promise<SearchProdutosResult | null> {
    const local = getCachedCatalogSearch(key);
    if (local) return local;

    const redis = redisOrNull();
    if (!redis || ttlMs() <= 0) return null;
    try {
        const raw = await redis.get<SearchProdutosResult>(redisKey(key));
        if (raw && typeof raw === "object") {
            setCachedCatalogSearch(key, raw);
            return raw;
        }
    } catch (err) {
        console.warn(
            "[catalogCache] Upstash GET falhou",
            err instanceof Error ? err.message : err
        );
    }
    return null;
}

export async function setCachedCatalogSearchAsync(
    key: string,
    value: SearchProdutosResult
): Promise<void> {
    setCachedCatalogSearch(key, value);
    const redis = redisOrNull();
    if (!redis || ttlMs() <= 0) return;
    try {
        await redis.set(redisKey(key), value, { ex: ttlSec() });
    } catch (err) {
        console.warn(
            "[catalogCache] Upstash SET falhou",
            err instanceof Error ? err.message : err
        );
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
