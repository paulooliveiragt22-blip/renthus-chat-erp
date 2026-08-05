/**
 * Wake HTTP do worker `GET /api/chatbot/process-queue`.
 * Usado pelo webhook (pós-enqueue) e pelo próprio worker (self-drain em pico).
 */

export function resolveQueueWorkerWakeOrigin(): string | null {
    const direct =
        process.env.CHATBOT_QUEUE_WAKE_URL?.trim() ||
        process.env.APP_INTERNAL_URL?.trim() ||
        process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (direct) {
        const trimmed = direct.replace(/\/+$/, "");
        if (/^https?:\/\//i.test(trimmed)) return trimmed;
        return `https://${trimmed}`;
    }
    const vercel = process.env.VERCEL_URL?.trim();
    if (!vercel) return null;
    const host = vercel.replace(/^https?:\/\//, "").split("/")[0]?.replace(/\/+$/, "") ?? "";
    return host ? `https://${host}` : null;
}

function wakeEnabled(): boolean {
    return process.env.CHATBOT_QUEUE_WAKE_ENABLED !== "0";
}

export function getQueueDrainMaxDepth(): number {
    const raw = Number(process.env.CHATBOT_QUEUE_DRAIN_MAX ?? "5");
    if (!Number.isFinite(raw) || raw < 1) return 5;
    return Math.min(Math.floor(raw), 20);
}

/**
 * Dispara o worker de forma fire-and-forget.
 * `drainDepth` limita a cadeia de self-wake (evita loop infinito serverless).
 */
export function scheduleQueueWorkerWake(opts?: {
    drainDepth?: number;
    reason?: string;
}): void {
    if (!wakeEnabled()) return;

    const origin = resolveQueueWorkerWakeOrigin();
    const secret = process.env.CRON_SECRET?.trim();
    if (!origin || !secret) {
        if (process.env.NODE_ENV === "development") {
            console.warn(
                "[queue-wake] skipped: define CRON_SECRET e CHATBOT_QUEUE_WAKE_URL (ou APP_INTERNAL_URL / NEXT_PUBLIC_APP_URL)"
            );
        }
        return;
    }

    const depth = Math.max(0, Math.floor(opts?.drainDepth ?? 0));
    const maxDepth = getQueueDrainMaxDepth();
    if (depth >= maxDepth) {
        console.info("[queue-wake] drain depth cap reached", { depth, maxDepth, reason: opts?.reason });
        return;
    }

    const qs = depth > 0 ? `?drain=${depth}` : "";
    const url = `${origin}/api/chatbot/process-queue${qs}`;
    const reason = opts?.reason ?? "wake";

    // Não await — fire-and-forget (mesmo padrão do webhook com after())
    void fetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${secret}` },
    })
        .then((res) => {
            if (!res.ok) {
                console.warn("[queue-wake] HTTP", res.status, res.statusText, { reason, depth });
            }
        })
        .catch((err: unknown) => {
            console.warn(
                "[queue-wake] fetch failed:",
                err instanceof Error ? err.message : err,
                { reason, depth }
            );
        });
}
