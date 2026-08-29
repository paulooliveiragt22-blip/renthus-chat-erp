import "server-only";
import type { AdminClient } from "./types";

/** Remove jobs terminais (`done`/`failed`) antigos — default 24h; override via env. */
export async function cleanupOldJobs(admin: AdminClient): Promise<void> {
    const hoursRaw = Number(process.env.CHATBOT_QUEUE_RETENTION_HOURS ?? "24");
    const hours =
        Number.isFinite(hoursRaw) && hoursRaw >= 1 ? Math.min(168, Math.floor(hoursRaw)) : 24;
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    await admin
        .from("chatbot_queue")
        .delete()
        .in("status", ["done", "failed"])
        .lt("created_at", cutoff);
}

export interface QueueMetricCounts {
    processed: number;
    failed: number;
    coalesced: number;
    reclaimed?: number;
    claimed?: number;
    continued?: boolean;
}

/**
 * Emite métricas do worker sem SELECT extra no Postgres (Fase 5).
 * Idade/pending: CloudWatch SQS + platform `getQueueHealthStats`.
 */
export async function emitQueueMetrics(_admin: AdminClient, counts: QueueMetricCounts): Promise<void> {
    const payload = {
        source: "chatbot_process_queue",
        ts: Date.now(),
        ...counts,
    };

    const ingestUrl = process.env.METRICS_INGEST_URL;
    if (ingestUrl) {
        try {
            const headers: Record<string, string> = { "content-type": "application/json" };
            if (process.env.METRICS_INGEST_TOKEN) {
                headers.authorization = `Bearer ${process.env.METRICS_INGEST_TOKEN}`;
            }
            await fetch(ingestUrl, {
                method: "POST",
                headers,
                body: JSON.stringify(payload),
            });
            return;
        } catch {
            // fallback para console abaixo
        }
    }

    console.info("[metric] chatbot_process_queue", payload);
}
