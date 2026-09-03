/**
 * Semáforo LLM distribuído (Upstash) — teto global por provider e por company_id.
 * Fail-open se Redis não estiver configurado ou falhar.
 */

import { Redis } from "@upstash/redis";

function redisOrNull(): Redis | null {
    if (
        !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
        !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
    ) {
        return null;
    }
    return Redis.fromEnv();
}

function positiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return Math.min(64, n);
}

/** 0 = desligado. Default 0 (só in-flight local). */
export function globalLlmMaxInFlight(): number {
    return positiveIntEnv("LLM_GLOBAL_MAX_IN_FLIGHT", 0);
}

/** 0 = desligado. Default 4 quando Upstash ativo (caller decide). */
export function companyLlmMaxInFlight(): number {
    return positiveIntEnv("COMPANY_LLM_MAX_IN_FLIGHT", 4);
}

async function withRedisCounter<T>(
    key: string,
    limit: number,
    ttlSec: number,
    fn: () => Promise<T>
): Promise<T> {
    if (limit <= 0) return fn();
    const redis = redisOrNull();
    if (!redis) return fn();

    let acquired = false;
    try {
        const n = await redis.incr(key);
        acquired = true;
        if (n === 1) {
            await redis.expire(key, ttlSec);
        }
        if (n > limit) {
            const err = new Error("llm_company_or_global_cap");
            (err as { status?: number }).status = 429;
            throw err;
        }
        return await fn();
    } catch (err) {
        if ((err as { status?: number }).status === 429) throw err;
        // Se já adquiriu o slot Redis, o erro veio de `fn` (ex.: tool schema) — não mascarar
        // como falha de Upstash. Só fail-open quando o próprio Redis falhou antes de adquirir.
        if (acquired) throw err;
        console.warn(
            "[llmCap] Upstash falhou — fail-open",
            err instanceof Error ? err.message : err
        );
        return fn();
    } finally {
        if (acquired) {
            try {
                await redisOrNull()?.decr(key);
            } catch {
                /* best-effort */
            }
        }
    }
}

/**
 * Envolve `fn` com tetos Redis opcionais (global provider + company).
 * Sem Upstash ou limit 0 → passa direto.
 */
export async function runWithDistributedLlmCap<T>(params: {
    provider: string;
    companyId?: string | null;
    fn: () => Promise<T>;
}): Promise<T> {
    const globalCap = globalLlmMaxInFlight();
    const companyCap = companyLlmMaxInFlight();
    const companyId = params.companyId?.trim() || "";

    const runCompany = () => {
        if (!companyId || companyCap <= 0) return params.fn();
        return withRedisCounter(
            `renthus:llm:company:${companyId}`,
            companyCap,
            120,
            params.fn
        );
    };

    if (globalCap <= 0) return runCompany();
    return withRedisCounter(
        `renthus:llm:global:${params.provider}`,
        globalCap,
        120,
        runCompany
    );
}
