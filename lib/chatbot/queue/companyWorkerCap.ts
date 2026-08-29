/**
 * Semáforo de fairness por company_id no worker SQS/Lambda (ADR-0003).
 * Substitui max_per_company do claim SQL no hot path.
 * Fail-open se Upstash ausente ou falhar.
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

/** Default 2 — alinhado a CHATBOT_QUEUE_MAX_PER_COMPANY do claim SQL. 0 = desligado. */
export function companyWorkerMaxInFlight(): number {
    return positiveIntEnv("CHATBOT_QUEUE_MAX_PER_COMPANY", 2);
}

export class CompanyWorkerCapError extends Error {
    readonly code = "company_worker_cap";
    constructor(companyId: string, limit: number) {
        super(`company_worker_cap:${companyId}:limit=${limit}`);
        this.name = "CompanyWorkerCapError";
    }
}

/**
 * Executa fn sob teto por company_id (Redis INCR/DECR).
 * Sem Redis ou limit<=0 → passa direto.
 */
export async function runWithCompanyWorkerCap<T>(params: {
    companyId: string;
    fn: () => Promise<T>;
    limit?: number;
    ttlSec?: number;
}): Promise<T> {
    const limit = params.limit ?? companyWorkerMaxInFlight();
    const companyId = params.companyId?.trim() || "";
    if (!companyId || limit <= 0) return params.fn();

    const redis = redisOrNull();
    if (!redis) return params.fn();

    const key = `renthus:worker:company:${companyId}`;
    const ttlSec = params.ttlSec ?? 180;
    let acquired = false;

    try {
        const n = await redis.incr(key);
        acquired = true;
        if (n === 1) {
            await redis.expire(key, ttlSec);
        }
        if (n > limit) {
            throw new CompanyWorkerCapError(companyId, limit);
        }
        return await params.fn();
    } catch (err) {
        if (err instanceof CompanyWorkerCapError) throw err;
        console.warn(
            "[companyWorkerCap] Upstash falhou — fail-open",
            err instanceof Error ? err.message : err
        );
        if (!acquired) return params.fn();
        throw err;
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
