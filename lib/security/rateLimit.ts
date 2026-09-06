import { NextResponse } from "next/server";

type Bucket = {
    count: number;
    resetAt: number;
};

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
    allowed: boolean;
    retryAfterSeconds: number;
    remaining: number;
};

/** Janela padrão de 1 minuto (rotas admin/financeiro). */
export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Janela de 15 minutos (signup, login público). */
export const RATE_LIMIT_WINDOW_15M_MS = 15 * 60_000;

/**
 * IP do cliente (primeiro hop de X-Forwarded-For ou X-Real-IP).
 * Em serverless atrás da Vercel, X-Forwarded-For é a fonte usual.
 */
export function requesterIp(req: Request | { headers: Headers }): string {
    const xff = req.headers.get("x-forwarded-for");
    if (xff) return xff.split(",")[0]?.trim() || "unknown";
    return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Simple in-memory fixed-window rate limiter.
 * Good enough for baseline protection; em várias instâncias serverless o limite dilui-se.
 * Para APIs críticas em produção, complementar com Upstash Redis, Cloudflare ou WAF.
 */
export function checkRateLimit(
    key: string,
    limit: number,
    windowMs: number
): RateLimitResult {
    const now = Date.now();
    const existing = buckets.get(key);

    if (!existing || now >= existing.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return {
            allowed: true,
            retryAfterSeconds: Math.ceil(windowMs / 1000),
            remaining: Math.max(0, limit - 1),
        };
    }

    if (existing.count >= limit) {
        return {
            allowed: false,
            retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
            remaining: 0,
        };
    }

    existing.count += 1;
    buckets.set(key, existing);

    return {
        allowed: true,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
        remaining: Math.max(0, limit - existing.count),
    };
}

export function checkRateLimitByIp(
    prefix: string,
    req: Request | { headers: Headers },
    limit: number,
    windowMs: number
): RateLimitResult {
    return checkRateLimit(`${prefix}:${requesterIp(req)}`, limit, windowMs);
}

export function rateLimitExceededResponse(
    rl: RateLimitResult,
    body: Record<string, unknown> = { error: "rate_limit_exceeded" }
): NextResponse {
    return NextResponse.json(body, {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSeconds) },
    });
}

/** Retorna 429 ou `null` se dentro do limite (só memória local). */
export function enforceIpRateLimit(
    req: Request | { headers: Headers },
    prefix: string,
    limit: number,
    windowMs: number,
    body: Record<string, unknown> = { error: "rate_limit_exceeded" }
): NextResponse | null {
    const rl = checkRateLimitByIp(prefix, req, limit, windowMs);
    if (rl.allowed) return null;
    return rateLimitExceededResponse(rl, body);
}

/**
 * Preferir em rotas públicas/webhooks: usa Upstash se `UPSTASH_REDIS_REST_*` estiver
 * configurado; senão cai no in-memory. Ver `rateLimitDistributed.ts`.
 */
export async function enforceIpRateLimitAsync(
    req: Request | { headers: Headers },
    prefix: string,
    limit: number,
    windowMs: number,
    body: Record<string, unknown> = { error: "rate_limit_exceeded" }
): Promise<NextResponse | null> {
    const { enforceIpRateLimitAsync: distributed } = await import(
        "@/lib/security/rateLimitDistributed"
    );
    return distributed(req, prefix, limit, windowMs, body);
}

/** Rate limit por chave arbitrária (email/CNPJ/slug). Ver `rateLimitDistributed`. */
export async function enforceKeyRateLimitAsync(
    key: string,
    limit: number,
    windowMs: number,
    body: Record<string, unknown> = { error: "rate_limit_exceeded" }
): Promise<NextResponse | null> {
    const { enforceKeyRateLimitAsync: distributed } = await import(
        "@/lib/security/rateLimitDistributed"
    );
    return distributed(key, limit, windowMs, body);
}

/** Limpa buckets expirados (evita crescimento em processos longos). */
export function pruneRateLimitBuckets(): void {
    const now = Date.now();
    for (const [k, v] of buckets) {
        if (now >= v.resetAt) buckets.delete(k);
    }
}

/** Só para testes unitários — zera contadores in-memory. */
export function resetRateLimitForTests(): void {
    buckets.clear();
}
