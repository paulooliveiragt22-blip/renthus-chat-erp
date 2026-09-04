/**
 * TTL do cache `billing_checkout_idempotency` (PIX/cartão).
 * Lookup só reutiliza resposta se `created_at` estiver dentro da janela.
 */

export const BILLING_CHECKOUT_IDEMPOTENCY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function isCheckoutIdempotencyFresh(
    createdAtIso: string | null | undefined,
    nowMs: number = Date.now(),
    ttlMs: number = BILLING_CHECKOUT_IDEMPOTENCY_TTL_MS
): boolean {
    if (!createdAtIso) return false;
    const t = Date.parse(createdAtIso);
    if (!Number.isFinite(t)) return false;
    return nowMs - t <= ttlMs;
}
