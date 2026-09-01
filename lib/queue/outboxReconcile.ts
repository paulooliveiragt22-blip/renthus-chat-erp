/**
 * Reconciler outbox ADR-0003 Fase 5 — pending sem SQS + processing stale.
 * Usado pela Lambda `renthus-outbox-reconcile` (EventBridge).
 *
 * Fase 7 (ADR-0003): schedule EventBridge alterado de 5min → 15min (operacional,
 * ver `scripts/setup-eventbridge-scheduler.ps1`). Reconciler deve ser REDE DE
 * SEGURANÇA, não caminho principal. Se `inboundNeverEnqueued > 0` em 3 janelas
 * consecutivas, log warning para Sentry/CloudWatch — investigar causa raiz
 * (visibility, ESM, IAM), não escalar reenfileiramento silencioso.
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
        .limit(limit);

    if (error || !data?.length) return [];

    const ids = data.map((r) => r.id as string);
    await admin
        .from("outbound_jobs")
        .update({
            status: "pending",
            processing_started_at: null,
            sqs_enqueued_at: null,
            sqs_message_id: null,
            last_error: "reclaimed_stuck_processing",
        })
        .in("id", ids);

    return data as OutboxJobRef[];
}

async function findNeverEnqueuedPending(
    admin: AdminClient,
    table: "chatbot_queue" | "outbound_jobs",
    minAgeIso: string,
    limit: number
): Promise<OutboxJobRef[]> {
    const maxAtt = table === "chatbot_queue" ? MAX_ATTEMPTS : outboundMaxAttempts();
    const { data, error } = await admin
        .from(table)
        .select("id, company_id, thread_id")
        .eq("status", "pending")
        .is("sqs_enqueued_at", null)
        .lte("scheduled_at", new Date().toISOString())
        .lt("created_at", minAgeIso)
        .lt("attempts", maxAtt)
        .order("created_at", { ascending: true })
        .limit(limit);

    if (error) {
        console.warn("[outboxReconcile] select failed", table, error.message);
        return [];
    }
    return (data ?? []) as OutboxJobRef[];
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
        const res = await dispatch(admin, job);
        if (res.ok && !res.skipped) {
            dispatched += 1;
        } else if (!res.ok) {
            errors += 1;
            console.warn("[outboxReconcile] dispatch failed", kind, job.id, res.error);
        }
    }
    return { dispatched, errors };
}

/**
 * Scan outbox: reclaim stuck → re-dispatch pending sem SQS enfileirado.
 * No-op quando SQS dispatch desligado (dev/test).
 */
export async function reconcileOutbox(
    admin: AdminClient,
    opts: ReconcileOptions = {}
): Promise<ReconcileStats> {
    const stats: ReconcileStats = {
        inboundNeverEnqueued: 0,
        outboundNeverEnqueued: 0,
        inboundStuckReclaimed: 0,
        outboundStuckReclaimed: 0,
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

    const [inboundNever, outboundNever] = await Promise.all([
        findNeverEnqueuedPending(admin, "chatbot_queue", minAgeIso, batchLimit),
        findNeverEnqueuedPending(admin, "outbound_jobs", minAgeIso, batchLimit),
    ]);

    const inboundToDispatch = dedupe([...inboundStuck, ...inboundNever], new Set<string>());
    const outboundToDispatch = dedupe([...outboundStuck, ...outboundNever], new Set<string>());

    const inDispatch = await dispatchJobs(admin, "inbound", inboundToDispatch);
    const outDispatch = await dispatchJobs(admin, "outbound", outboundToDispatch);

    stats.inboundNeverEnqueued = inboundNever.length;
    stats.outboundNeverEnqueued = outboundNever.length;
    stats.dispatchErrors = inDispatch.errors + outDispatch.errors;

    // Fase 7 (ADR-0003): alerta operacional quando reconciler está fazendo trabalho
    // que deveria ter sido feito pela Lambda. Em prod saudável esses números são 0.
    if (stats.inboundNeverEnqueued > 0 || stats.outboundNeverEnqueued > 0) {
        console.warn(
            "[outboxReconcile] ⚠️ jobs reenfileirados pelo reconciler — investigar ESM/SQS/visibility",
            {
                inboundNeverEnqueued: stats.inboundNeverEnqueued,
                outboundNeverEnqueued: stats.outboundNeverEnqueued,
                inboundStuckReclaimed: stats.inboundStuckReclaimed,
                outboundStuckReclaimed: stats.outboundStuckReclaimed,
            }
        );
    }
    if (stats.inboundStuckReclaimed > 0 || stats.outboundStuckReclaimed > 0) {
        console.warn(
            "[outboxReconcile] ⚠️ jobs processing stale foram reclamados — investigar timeout ou crash",
            {
                inboundStuckReclaimed: stats.inboundStuckReclaimed,
                outboundStuckReclaimed: stats.outboundStuckReclaimed,
                staleMinutes,
            }
        );
    }

    console.info("[outboxReconcile] done", stats);
    return stats;
}
