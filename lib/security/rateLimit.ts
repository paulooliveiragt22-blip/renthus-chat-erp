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
