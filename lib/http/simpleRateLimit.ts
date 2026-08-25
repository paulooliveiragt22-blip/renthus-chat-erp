/**
 * @deprecated Prefer `checkRateLimit` / `enforceIpRateLimit` em `lib/security/rateLimit.ts`.
 * Mantido para compatibilidade — usa o mesmo store in-memory.
 */
import { checkRateLimit, pruneRateLimitBuckets } from "@/lib/security/rateLimit";

export { pruneRateLimitBuckets };

export function simpleRateLimit(params: {
    key: string;
    limit: number;
    windowMs: number;
}): { ok: true } | { ok: false; retryAfterSec: number } {
    const rl = checkRateLimit(params.key, params.limit, params.windowMs);
    if (rl.allowed) return { ok: true };
    return { ok: false, retryAfterSec: rl.retryAfterSeconds };
}
