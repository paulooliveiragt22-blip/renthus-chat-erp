import "server-only";

/** Lê um inteiro positivo de env var, com fallback se ausente/inválido. */
export function getPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) return fallback;
    return Math.floor(value);
}

/** Tentativas máximas antes de marcar job como `failed` terminal. Compartilhado entre
 * `route.ts` (fallback dev) e `runQueueEntry.ts` (retry/backoff). */
export const MAX_ATTEMPTS = 3;
