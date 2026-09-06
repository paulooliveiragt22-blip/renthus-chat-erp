/**
 * Helpers HTTP do cardápio público (B12).
 *
 * Rate limit canônico: chave `bucket:ip:slug` (Upstash quando configurado).
 * Session token de outro slug continua rejeitado nas rotas (já existente).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkRateLimitAsync } from "@/lib/security/rateLimitDistributed";
import {
    requesterIp as requesterIpFromSecurity,
    type RateLimitResult,
} from "@/lib/security/rateLimit";

export { requesterIpFromSecurity as requesterIp };

export function publicMenuRateLimitKey(
    bucket: string,
    ip: string,
    slug: string
): string {
    return `${bucket}:${ip}:${slug}`;
}

/**
 * Rate limit por IP + slug (janela default 60s).
 * Preferir `enforcePublicMenuRateLimit` nas rotas.
 */
export async function publicMenuRateLimit(
    req: NextRequest,
    bucket: string,
    slug: string,
    limit: number,
    windowMs = 60_000
): Promise<RateLimitResult> {
    const key = publicMenuRateLimitKey(bucket, requesterIpFromSecurity(req), slug);
    return checkRateLimitAsync(key, limit, windowMs);
}

/** `null` se ok; Response 429 se excedeu. */
export async function enforcePublicMenuRateLimit(
    req: NextRequest,
    bucket: string,
    slug: string,
    limit: number,
    windowMs = 60_000
): Promise<NextResponse | null> {
    const rl = await publicMenuRateLimit(req, bucket, slug, limit, windowMs);
    if (rl.allowed) return null;
    return NextResponse.json(
        { ok: false, error: "rate_limit_exceeded" },
        {
            status: 429,
            headers: { "Retry-After": String(rl.retryAfterSeconds) },
        }
    );
}
