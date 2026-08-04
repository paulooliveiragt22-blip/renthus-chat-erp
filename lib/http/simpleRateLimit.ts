/**
 * Rate limit in-memory (best-effort, por instância).
 * Suficiente para frear abuso óbvio em rotas públicas como activate.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function simpleRateLimit(params: {
    key: string;
    limit: number;
    windowMs: number;
}): { ok: true } | { ok: false; retryAfterSec: number } {
    const now = Date.now();
    const cur = buckets.get(params.key);
    if (!cur || now >= cur.resetAt) {
        buckets.set(params.key, { count: 1, resetAt: now + params.windowMs });
        return { ok: true };
    }
    if (cur.count >= params.limit) {
        return {
            ok: false,
            retryAfterSec: Math.max(1, Math.ceil((cur.resetAt - now) / 1000)),
        };
    }
    cur.count += 1;
    return { ok: true };
}

/** Limpa buckets expirados (opcional, evita crescimento infinito em processos longos). */
export function pruneRateLimitBuckets(): void {
    const now = Date.now();
    for (const [k, v] of buckets) {
        if (now >= v.resetAt) buckets.delete(k);
    }
}
