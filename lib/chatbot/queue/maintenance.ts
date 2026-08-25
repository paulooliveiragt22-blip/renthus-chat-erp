import "server-only";
import type { AdminClient } from "./types";

/** Reclaim de jobs `processing` travados (timeout serverless / crash) via RPC. Nunca lança —
 * best-effort, retorna 0 em caso de erro (o worker segue tentando claim normal). */
export async function reclaimStuckJobs(admin: AdminClient, staleMinutes: number): Promise<number> {
    try {
        const { data: reclaimCount, error: reclaimErr } = await admin.rpc(
            "reclaim_stuck_chatbot_queue_jobs",
            { stale_minutes: staleMinutes }
        );
        if (reclaimErr) {
            console.warn("[process-queue] reclaim_stuck:", reclaimErr.message);
            return 0;
        }
        const reclaimed = Number(reclaimCount ?? 0) || 0;
        if (reclaimed > 0) {
            console.info("[process-queue] reclaimed stuck jobs", { reclaimed });
        }
        return reclaimed;
    } catch (err: unknown) {
        console.warn(
            "[process-queue] reclaim_stuck failed:",
            err instanceof Error ? err.message : err
        );
        return 0;
    }
}

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
 * Emite métricas do worker (`METRICS_INGEST_URL` se configurado, senão `console.info`).
 * Nota (registrada, não corrigida aqui — fora do escopo desta extração): faz 2 SELECTs extras
 * (count + oldest pending) em toda invocação, mesmo sem `METRICS_INGEST_URL`. Em self-wake
 * frequente isso é overhead evitável; revisitar se houver dado real de carga em produção.
 */
export async function emitQueueMetrics(admin: AdminClient, counts: QueueMetricCounts): Promise<void> {
    let oldestPendingAgeSec = 0;
    let pendingNow = 0;
    try {
        const { count } = await admin
            .from("chatbot_queue")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending");
        pendingNow = count ?? 0;
        const { data: oldest } = await admin
            .from("chatbot_queue")
            .select("scheduled_at")
            .eq("status", "pending")
            .order("scheduled_at", { ascending: true })
            .limit(1)
            .maybeSingle();
        if (typeof oldest?.scheduled_at === "string") {
            oldestPendingAgeSec = Math.max(
                0,
                Math.floor((Date.now() - new Date(oldest.scheduled_at).getTime()) / 1000)
            );
        }
    } catch {
        /* best-effort */
    }

    const payload = {
        source: "chatbot_process_queue",
        ts: Date.now(),
        reclaimed: 0,
        pendingNow,
        oldestPendingAgeSec,
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
