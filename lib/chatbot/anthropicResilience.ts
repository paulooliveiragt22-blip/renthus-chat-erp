/**
 * Retry + circuit breaker para 429 Anthropic (pico fim de semana).
 * Usa o gate in-flight por instância; sem Redis ainda não há teto global entre réplicas.
 */

import { runWithAnthropicInFlightSlot } from "@/lib/chatbot/anthropicInFlightGate";

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isAnthropicRateLimitError(error: unknown): boolean {
    if (!error || typeof error !== "object") return false;
    const e = error as { status?: number; message?: unknown; error?: { type?: string } };
    if (e.status === 429) return true;
    const m = String(e.message ?? "").toLowerCase();
    if (m.includes("429") || m.includes("rate limit") || m.includes("too many requests")) return true;
    if (String(e.error?.type ?? "").toLowerCase().includes("rate_limit")) return true;
    return false;
}

function retryAfterMs(error: unknown, attempt: number): number {
    const e = error as { headers?: { get?: (k: string) => string | null }; retryAfter?: number };
    const header =
        typeof e.headers?.get === "function" ? e.headers.get("retry-after") : null;
    if (header) {
        const sec = Number(header);
        if (Number.isFinite(sec) && sec > 0) return Math.min(30_000, sec * 1000);
    }
    if (typeof e.retryAfter === "number" && e.retryAfter > 0) {
        return Math.min(30_000, e.retryAfter * 1000);
    }
    const base = Math.min(8_000, 400 * 2 ** attempt);
    return base + Math.floor(Math.random() * 250);
}

let circuitOpenUntilMs = 0;
let consecutive429 = 0;

export function getAnthropicCircuitOpenRemainingMs(): number {
    return Math.max(0, circuitOpenUntilMs - Date.now());
}

/** Só para testes unitários. */
export function resetAnthropicCircuitForTests(): void {
    circuitOpenUntilMs = 0;
    consecutive429 = 0;
}

function tripCircuit(): void {
    const openMs = getPositiveIntEnv("ANTHROPIC_CIRCUIT_OPEN_MS", 30_000);
    circuitOpenUntilMs = Date.now() + openMs;
    console.warn("[anthropic] circuit open", { openMs, consecutive429 });
}

function getPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name];
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.floor(n);
}

/**
 * Executa chamada Anthropic com:
 * - gate in-flight
 * - até N retries em 429 com backoff
 * - circuit breaker após 3× 429 seguidos
 */
export async function runAnthropicWithResilience<T>(
    fn: () => Promise<T>,
    opts?: { maxRetries?: number }
): Promise<T> {
    const remaining = getAnthropicCircuitOpenRemainingMs();
    if (remaining > 0) {
        const err = new Error("anthropic_circuit_open");
        (err as { status?: number }).status = 429;
        throw err;
    }

    const maxRetries = Math.min(5, Math.max(0, opts?.maxRetries ?? 3));
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const openMs = getAnthropicCircuitOpenRemainingMs();
        if (openMs > 0 && attempt > 0) {
            const err = new Error("anthropic_circuit_open");
            (err as { status?: number }).status = 429;
            throw err;
        }
        try {
            const result = await runWithAnthropicInFlightSlot(fn);
            consecutive429 = 0;
            return result;
        } catch (error) {
            lastError = error;
            if (!isAnthropicRateLimitError(error) || attempt >= maxRetries) {
                if (isAnthropicRateLimitError(error)) {
                    consecutive429 += 1;
                    if (consecutive429 >= 3) tripCircuit();
                }
                throw error;
            }
            consecutive429 += 1;
            if (consecutive429 >= 3) tripCircuit();
            const wait = retryAfterMs(error, attempt);
            console.warn("[anthropic] 429 backoff", { attempt, waitMs: wait });
            await sleep(wait);
        }
    }

    throw lastError;
}
