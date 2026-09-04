/**
 * lib/chatbot/queue/outboxReconcile.ts
 *
 * ADR-0003 Fase 14 — RESTAURADO. O reconciler volta a reenfileirar ativamente
 * jobs pendentes que ficaram sem `sqs_enqueued_at` (perdeu SendMessage) e
 * marca `processing` stale (>3min) como `pending` para reprocessar.
 *
 * DIFERENÇA vs Fase 13 (DLQ-only):
 *  - Fase 13: só alertava Sentry (Lambda direto não precisa de reenfileirar)
 *  - Fase 14: reenfileira ativamente via SQS (caminho SQS-first; SQS pode perder mensagem
 *    se reconciler não reenfileirar)
 *
 * Schedule EventBridge: `rate(5 minutes)` (volta ao original da Fase 0-6).
 */

import "server-only";
import type { AdminClient } from "@/lib/chatbot/queue/types";
import { MAX_ATTEMPTS } from "@/lib/chatbot/queue/env";
import {
    dispatchInboundJob,
    dispatchOutboundJob,
    isSqsDispatchEnabled,
} from "@/lib/queue/sqsDispatch";

export type OutboxJobRef = {
    id: string;
    company_id: string;
    thread_id: string;
};

export type ReconcileStats = {
    inboundNeverEnqueued: number;
    outboundNeverEnqueued: number;
    inboundStuckReclaimed: number;
    outboundStuckReclaimed: number;
    inboundSilentOrphans: number;
    dispatchErrors: number;
};

export type ReconcileOptions = {
    /** Idade mínima (ms) antes de re-dispatch de pending sem sqs_enqueued_at. Default 2 min. */
    neverEnqueuedMinAgeMs?: number;
    /** Minutos em processing antes de reclaim. Default CHATBOT_QUEUE_STALE_MINUTES ou 3. */
    staleProcessingMinutes?: number;
    /** Limite por tabela por execução. */
    batchLimit?: number;
};

function positiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 1) return fallback;
    return n;
}

function outboundMaxAttempts(): number {
    const raw = process.env.OUTBOUND_MAX_ATTEMPTS?.trim();
    if (!raw) return 3;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : 3;
}
async function reclaimStuckInbound(
    admin: AdminClient,
    staleMinutes: number,
    limit: number
): Promise<OutboxJobRef[]> {
    const staleMs = staleMinutes * 60_000;
    const now = Date.now();
    const { data, error } = await admin
        .from("chatbot_queue")
        .select("id, company_id, thread_id, processing_started_at, scheduled_at")
        .eq("status", "processing")
        .lt("attempts", MAX_ATTEMPTS)
        .limit(Math.min(limit * 3, 150));

    if (error || !data?.length) return [];

    const stale = data.filter((row) => {
        const started = row.processing_started_at as string | null | undefined;
        const anchor = started ? new Date(started).getTime() : new Date(String(row.scheduled_at)).getTime();
        return anchor < now - staleMs;
    }).slice(0, limit);

    if (!stale.length) return [];

    const ids = stale.map((r) => r.id as string);
    await admin
        .from("chatbot_queue")
        .update({
            status: "pending",
            processing_started_at: null,
            sqs_enqueued_at: null,
            sqs_message_id: null,
            last_error: "reclaimed_stuck_processing",
        })
        .in("id", ids);

    return stale.map(({ id, company_id, thread_id }) => ({
        id: id as string,
        company_id: company_id as string,
        thread_id: thread_id as string,
    }));
}

async function reclaimStuckOutbound(
    admin: AdminClient,
    staleMinutes: number,
    limit: number
): Promise<OutboxJobRef[]> {
    const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
    const maxAtt = outboundMaxAttempts();
    const { data, error } = await admin
        .from("outbound_jobs")
        .select("id, company_id, thread_id")
        .eq("status", "processing")
        .lt("attempts", maxAtt)
        .lt("processing_started_at", cutoff)
        .limit(Math.min(limit * 3, 150));

    if (error || !data?.length) return [];

    const ids = data.map((r) => r.id as string);
    await admin
        .from("outbound_jobs")
        .update({
            status: "pending",
            processing_started_at: null,
            sqs_enqueued_at: null,
            sqs_message_id: null,
        })
        .in("id", ids);

    return data.map(({ id, company_id, thread_id }) => ({
        id: id as string,
        company_id: company_id as string,
        thread_id: thread_id as string,
    }));
}

async function findNeverEnqueuedPending(
    admin: AdminClient,
    table: "chatbot_queue" | "outbound_jobs",
    minAgeIso: string,
    maxAttempts: number,
    limit: number
): Promise<OutboxJobRef[]> {
    const { data, error } = await admin
        .from(table)
        .select("id, company_id, thread_id")
        .eq("status", "pending")
        .is("sqs_enqueued_at", null)
        .lte("scheduled_at", new Date().toISOString())
        .lt("created_at", minAgeIso)
        .lt("attempts", maxAttempts)
        .order("created_at", { ascending: true })
        .limit(limit);

    if (error) {
        console.warn("[outboxReconcile] select failed", table, error.message);
        return [];
    }
    return (data ?? []) as OutboxJobRef[];
}

/**
 * Pending com `sqs_enqueued_at` setado mas sem processing: SendMessage FIFO com o mesmo
 * MessageDeduplicationId (jobId) não entrega mensagem nova — o job fica órfão e o
 * backlogNotice dispara. Reclaim após a mesma idade do never-enqueued.
 */
async function findSilentOrphanPending(
    admin: AdminClient,
    minAgeIso: string,
    maxAttempts: number,
    limit: number
): Promise<OutboxJobRef[]> {
    const { data, error } = await admin
        .from("chatbot_queue")
        .select("id, company_id, thread_id")
        .eq("status", "pending")
        .not("sqs_enqueued_at", "is", null)
        .is("processing_started_at", null)
        .lte("scheduled_at", new Date().toISOString())
        .lt("sqs_enqueued_at", minAgeIso)
        .lt("attempts", maxAttempts)
        .order("created_at", { ascending: true })
        .limit(limit);

    if (error) {
        console.warn("[outboxReconcile] silent orphan select failed", error.message);
        return [];
    }
    const rows = (data ?? []) as OutboxJobRef[];
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    await admin
        .from("chatbot_queue")
        .update({
            sqs_enqueued_at: null,
            sqs_message_id: null,
            last_error: "reclaimed_fifo_dedup_orphan",
        })
        .in("id", ids);
    return rows;
}

function dedupe(jobs: OutboxJobRef[], seen: Set<string>): OutboxJobRef[] {
    return jobs.filter((j) => {
        if (seen.has(j.id)) return false;
        seen.add(j.id);
        return true;
    });
}

async function dispatchJobs(
    admin: AdminClient,
    kind: "inbound" | "outbound",
    jobs: OutboxJobRef[]
): Promise<{ dispatched: number; errors: number }> {
    let dispatched = 0;
    let errors = 0;
    const dispatch = kind === "inbound" ? dispatchInboundJob : dispatchOutboundJob;

    for (const job of jobs) {
        try {
            const res = await dispatch(admin, job, {
                deduplicationSalt: `rec-${Date.now()}-${dispatched}`,
            });
            if (res.ok && !res.skipped) {
                dispatched += 1;
            } else if (!res.ok) {
                errors += 1;
                console.warn("[outboxReconcile] dispatch failed", kind, job.id, res.error);
            }
        } catch {
            errors += 1;
        }
    }
    return { dispatched, errors };
}

export async function reconcileOutbox(
    admin: AdminClient,
    opts: ReconcileOptions = {}
): Promise<ReconcileStats> {
    const stats: ReconcileStats = {
        inboundNeverEnqueued: 0,
        outboundNeverEnqueued: 0,
        inboundStuckReclaimed: 0,
        outboundStuckReclaimed: 0,
        inboundSilentOrphans: 0,
        dispatchErrors: 0,
    };

    if (!isSqsDispatchEnabled()) {
        console.info("[outboxReconcile] SQS dispatch disabled — skip");
        return stats;
    }

    const neverEnqueuedMinAgeMs = opts.neverEnqueuedMinAgeMs ?? 2 * 60_000;
    const staleMinutes =
        opts.staleProcessingMinutes ??
        positiveIntEnv("CHATBOT_QUEUE_STALE_MINUTES", 3);
    const batchLimit = opts.batchLimit ?? 50;
    const minAgeIso = new Date(Date.now() - neverEnqueuedMinAgeMs).toISOString();

    const [inboundStuck, outboundStuck] = await Promise.all([
        reclaimStuckInbound(admin, staleMinutes, batchLimit),
        reclaimStuckOutbound(admin, staleMinutes, batchLimit),
    ]);

    stats.inboundStuckReclaimed = inboundStuck.length;
    stats.outboundStuckReclaimed = outboundStuck.length;

    const [inboundNever, outboundNever, inboundOrphans] = await Promise.all([
        findNeverEnqueuedPending(admin, "chatbot_queue", minAgeIso, MAX_ATTEMPTS, batchLimit),
        findNeverEnqueuedPending(admin, "outbound_jobs", minAgeIso, outboundMaxAttempts(), batchLimit),
        findSilentOrphanPending(admin, minAgeIso, MAX_ATTEMPTS, batchLimit),
    ]);

    stats.inboundSilentOrphans = inboundOrphans.length;

    const inboundToDispatch = dedupe(
        [...inboundStuck, ...inboundNever, ...inboundOrphans],
        new Set<string>()
    );
    const outboundToDispatch = dedupe([...outboundStuck, ...outboundNever], new Set<string>());

    const inDispatch = await dispatchJobs(admin, "inbound", inboundToDispatch);
    const outDispatch = await dispatchJobs(admin, "outbound", outboundToDispatch);

    stats.inboundNeverEnqueued = inboundNever.length;
    stats.outboundNeverEnqueued = outboundNever.length;
    stats.dispatchErrors = inDispatch.errors + outDispatch.errors;

    console.info("[outboxReconcile] done", stats);
    return stats;
}
