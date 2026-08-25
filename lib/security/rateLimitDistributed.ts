/**
 * Rate limit distribuído via Upstash Redis (opcional).
 *
 * Ativo quando `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN` estão definidos.
 * Sem env → fallback síncrono para `checkRateLimit` in-memory (mesmo contrato).
 *
 * Rotas públicas/webhooks devem preferir `checkRateLimitAsync` / `enforceIpRateLimitAsync`
 * para o limite valer entre réplicas Vercel.
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import {
    checkRateLimit,
    checkRateLimitByIp,
    rateLimitExceededResponse,
    requesterIp,
    type RateLimitResult,
} from "@/lib/security/rateLimit";

const limiterCache = new Map<string, Ratelimit>();

export function isDistributedRateLimitEnabled(): boolean {
    return Boolean(
        process.env.UPSTASH_REDIS_REST_URL?.trim() &&
            process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
    );
}

function getLimiter(limit: number, windowMs: number): Ratelimit | null {
    if (!isDistributedRateLimitEnabled()) return null;

    const windowSec = Math.max(1, Math.ceil(windowMs / 1000));
    const cacheKey = `${limit}:${windowSec}`;
    const cached = limiterCache.get(cacheKey);
    if (cached) return cached;

    const redis = Redis.fromEnv();
    const limiter = new Ratelimit({
        redis,
        limiter: Ratelimit.fixedWindow(limit, `${windowSec} s`),
        prefix: "renthus:rl",
        analytics: false,
    });
    limiterCache.set(cacheKey, limiter);
    return limiter;
}

/**
 * Fixed-window rate limit. Usa Upstash se configurado; senão memória local.
 * Em falha de rede do Redis, falha aberta (permite) e loga — não derruba webhook.
 */
export async function checkRateLimitAsync(
    key: string,
    limit: number,
    windowMs: number
): Promise<RateLimitResult> {
    const limiter = getLimiter(limit, windowMs);
    if (!limiter) {
        return checkRateLimit(key, limit, windowMs);
    }

    try {
        const result = await limiter.limit(key);
        const retryAfterSeconds = Math.max(
            1,
            Math.ceil((result.reset - Date.now()) / 1000)
        );
        return {
            allowed: result.success,
            retryAfterSeconds,
            remaining: Math.max(0, result.remaining),
        };
    } catch (err) {
        console.warn(
            "[rateLimit] Upstash falhou — fallback in-memory",
            err instanceof Error ? err.message : err
        );
        return checkRateLimit(key, limit, windowMs);
    }
}

export async function checkRateLimitByIpAsync(
    prefix: string,
    req: Request | { headers: Headers },
    limit: number,
    windowMs: number
): Promise<RateLimitResult> {
    if (!isDistributedRateLimitEnabled()) {
        return checkRateLimitByIp(prefix, req, limit, windowMs);
    }
    return checkRateLimitAsync(`${prefix}:${requesterIp(req)}`, limit, windowMs);
}

/** Retorna 429 ou `null` se dentro do limite (distribuído quando Upstash ativo). */
export async function enforceIpRateLimitAsync(
    req: Request | { headers: Headers },
    prefix: string,
    limit: number,
    windowMs: number,
    body: Record<string, unknown> = { error: "rate_limit_exceeded" }
): Promise<NextResponse | null> {
    const rl = await checkRateLimitByIpAsync(prefix, req, limit, windowMs);
    if (rl.allowed) return null;
    return rateLimitExceededResponse(rl, body);
}
