/**
 * Erros que a fila deve reprocessar com backoff (não marcar done).
 */

export class QueueRetryableError extends Error {
    readonly code: string;
    readonly retryable = true as const;

    constructor(code: string, message?: string) {
        super(message ?? code);
        this.name = "QueueRetryableError";
        this.code = code;
    }
}

export function isQueueRetryableError(error: unknown): boolean {
    if (error instanceof QueueRetryableError) return true;
    if (!error || typeof error !== "object") return false;
    const e = error as { retryable?: boolean; code?: string; message?: string };
    if (e.retryable === true) return true;
    const msg = String(e.message ?? "").toLowerCase();
    const code = String(e.code ?? "").toUpperCase();
    if (code === "AI_RATE_LIMIT" || code === "ANTHROPIC_CIRCUIT_OPEN") return true;
    if (
        msg.includes("429") ||
        msg.includes("rate limit") ||
        msg.includes("circuit_open") ||
        msg.includes("anthropic_circuit_open")
    ) {
        return true;
    }
    return false;
}

/** Backoff exponencial com jitter (ms), limitado. */
export function queueRetryDelayMs(attempts: number, opts?: { minMs?: number }): number {
    const n = Math.max(1, Math.min(10, Math.floor(attempts)));
    const base = Math.min(120_000, 2_000 * 2 ** (n - 1));
    const jitter = Math.floor(Math.random() * 500);
    return Math.max(opts?.minMs ?? 0, base + jitter);
}
