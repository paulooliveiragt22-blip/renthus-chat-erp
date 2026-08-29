/**
 * Coalesce inbound via Upstash SET NX (ADR-0003 Fase 5).
 * Fail-open → caller usa fallback PG.
 */

import { Redis } from "@upstash/redis";
import { getPositiveIntEnv } from "./env";

const INBOUND_COALESCE_WINDOW_SECONDS = getPositiveIntEnv("INBOUND_DEDUP_WINDOW_SECONDS", 20);

export type CoalesceRedisResult = "acquired" | "duplicate" | "unavailable";

function redisOrNull(): Redis | null {
    if (
        !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
        !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
    ) {
        return null;
    }
    return Redis.fromEnv();
}

function coalesceRedisKey(coalesceKey: string): string {
    return `renthus:coalesce:${coalesceKey}`;
}

/** SET NX EX — duplicate se a chave já existir na janela. */
export async function tryCoalesceRedisLock(coalesceKey: string): Promise<CoalesceRedisResult> {
    const redis = redisOrNull();
    if (!redis) return "unavailable";

    try {
        const result = await redis.set(coalesceRedisKey(coalesceKey), "1", {
            nx: true,
            ex: INBOUND_COALESCE_WINDOW_SECONDS,
        });
        return result === null ? "duplicate" : "acquired";
    } catch (err: unknown) {
        console.warn(
            "[coalesce] Upstash falhou — fallback PG",
            err instanceof Error ? err.message : err
        );
        return "unavailable";
    }
}

/** Test helper — expõe TTL usado pelo lock. */
export function coalesceWindowSecondsForTests(): number {
    return INBOUND_COALESCE_WINDOW_SECONDS;
}
