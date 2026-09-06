/**
 * Anti-abuso / anti-enum da superfície pública de signup (B11).
 *
 * - Rate limit IP (rota) + identidade (email / CNPJ).
 * - Conflitos de cadastro com mensagem única — sem revelar se o vazamento
 *   foi e-mail ou CNPJ (enum útil além do catálogo de planos).
 */

import "server-only";
import { NextResponse } from "next/server";
import {
    enforceKeyRateLimitAsync,
    RATE_LIMIT_WINDOW_15M_MS,
} from "@/lib/security/rateLimit";

export const BILLING_SIGNUP_IP_LIMIT = 10;
export const BILLING_SIGNUP_IDENTITY_LIMIT = 3;
export const BILLING_SIGNUP_WINDOW_MS = RATE_LIMIT_WINDOW_15M_MS;

/** Mensagem canônica de conflito (409) — e-mail ou CNPJ já em uso. */
export const SIGNUP_CONFLICT_MESSAGE =
    "Não foi possível concluir o cadastro com estes dados. Faça login ou fale com o suporte.";

export function signupConflictResponse(): NextResponse {
    return NextResponse.json({ error: SIGNUP_CONFLICT_MESSAGE }, { status: 409 });
}

export function signupEmailRateLimitKey(emailNorm: string): string {
    return `billing_signup_email:${emailNorm}`;
}

export function signupCnpjRateLimitKey(cnpjDigits: string): string {
    return `billing_signup_cnpj:${cnpjDigits}`;
}

/** Limita tentativas por e-mail e por CNPJ (além do IP na rota). */
export async function enforceSignupIdentityRateLimits(
    emailNorm: string,
    cnpjDigits: string
): Promise<NextResponse | null> {
    const byEmail = await enforceKeyRateLimitAsync(
        signupEmailRateLimitKey(emailNorm),
        BILLING_SIGNUP_IDENTITY_LIMIT,
        BILLING_SIGNUP_WINDOW_MS
    );
    if (byEmail) return byEmail;

    return enforceKeyRateLimitAsync(
        signupCnpjRateLimitKey(cnpjDigits),
        BILLING_SIGNUP_IDENTITY_LIMIT,
        BILLING_SIGNUP_WINDOW_MS
    );
}

/** Campos públicos do catálogo — nunca incluir UUID interno de `plans`. */
export const PUBLIC_PLAN_OFFER_KEYS = [
    "key",
    "name",
    "description",
    "list_monthly_cents",
    "offer_monthly_cents",
    "list_yearly_cents",
    "yearly_savings_percent",
    "included_seats",
    "seat_extra_cents",
    "popular",
    "promo",
] as const;

export function assertNoPlanIdInPublicOffer(offer: Record<string, unknown>): boolean {
    return !("id" in offer) && !("plan_id" in offer);
}
