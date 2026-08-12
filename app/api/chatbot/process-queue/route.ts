/**
 * app/api/chatbot/process-queue/route.ts
 *
 * Worker da chatbot_queue. Gatilhos:
 *   - Wake imediato pós-enqueue (`incoming`)
 *   - Self-wake ao drenar batch cheio (pico)
 *   - Scheduler externo (cron-job.org ≈1 min) + Vercel Cron diário (backup)
 *
 * Fluxo por invocação:
 *   0. Reclaim jobs `processing` stuck
 *   1. Claim atômico (pending → processing)
 *   2. processInboundMessage por job (lógica de negócio em lib/chatbot/queue/*)
 *   3. done / failed / retry
 *   4. Self-wake se ainda houver pending
 *   5. Limpa jobs > 24h
 *
 * Este arquivo é só auth + parse + orquestração. Lógica de negócio testável isoladamente
 * (sem Request/NextResponse) está em `lib/chatbot/queue/*` — ver item 8 de
 * docs/CHECKLIST_SEGURANCA_CONFIABILIDADE_P0.md. Fase 3 de docs/PLANO_ESCALA_PICOS_PEDIDOS.md
 * (paralelismo por thread) troca o `for` abaixo por `runWithConcurrencyLimit` chamando
 * `runQueueEntryWithOutcome` — sem precisar re-extrair nada.
 */

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { interleaveQueueJobsByCompany } from "@/lib/chatbot/interleaveQueueJobsByCompany";
import { scheduleQueueWorkerWake } from "@/lib/chatbot/queueWorkerWake";
import { validateCronAuthorization } from "@/lib/security/cronAuth";
import { getPositiveIntEnv, MAX_ATTEMPTS } from "@/lib/chatbot/queue/env";
import { cleanupOldJobs, emitQueueMetrics, reclaimStuckJobs } from "@/lib/chatbot/queue/maintenance";
import { runQueueEntryWithOutcome, type QueueEntryOutcome } from "@/lib/chatbot/queue/runQueueEntry";
import type { AdminClient, ChatbotQueueJobRow, QueueBatchCounters } from "@/lib/chatbot/queue/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_SIZE = 5;
/** Em produção nunca usar claim best-effort: duplo processamento entre instâncias. */
const ALLOW_CLAIM_FALLBACK = process.env.NODE_ENV !== "production";

const STALE_PROCESSING_MINUTES = getPositiveIntEnv("CHATBOT_QUEUE_STALE_MINUTES", 3);
const MAX_PER_COMPANY = getPositiveIntEnv("CHATBOT_QUEUE_MAX_PER_COMPANY", 2);

function parseDrainDepth(req: Request): number {
    try {
        const url = new URL(req.url);
        const raw = Number(url.searchParams.get("drain") ?? "0");
        if (!Number.isFinite(raw) || raw < 0) return 0;
        return Math.floor(raw);
    } catch {
        return 0;
    }
}

function tally(counters: QueueBatchCounters, outcome: QueueEntryOutcome): void {
    if (outcome === "processed") counters.processed++;
    else if (outcome === "coalesced") {
        counters.processed++;
        counters.coalesced++;
    } else {
        counters.failed++;
    }
}

export async function GET(req: Request) {
    const authHeader = req.headers.get("authorization");
    const authError = validateCronAuthorization(authHeader);
    if (authError) return authError;

    const admin = createAdminClient();
    const t0 = Date.now();
    const drainDepth = parseDrainDepth(req);

    // ── 0. Reclaim stuck processing (timeout serverless / crash) ─────────────
    const reclaimed = await reclaimStuckJobs(admin, STALE_PROCESSING_MINUTES);

    // ── 1. Claim jobs atomicamente via RPC ────────────────────────────────────
    // Atomic: UPDATE ... WHERE status='pending' AND attempts < MAX_ATTEMPTS
    //         RETURNING id — apenas o que este cron vai processar
    const { data: claimed, error: claimErr } = await admin.rpc("claim_chatbot_queue_jobs", {
        batch_size: BATCH_SIZE,
        max_attempts: MAX_ATTEMPTS,
        max_per_company: MAX_PER_COMPANY,
    });

    if (claimErr) {
        return handleClaimError(admin, t0, claimErr);
    }

    const jobIds: string[] = ((claimed ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (!jobIds.length) {
        // Reclaimou mas outro worker claimou na frente → tenta de novo via wake
        if (reclaimed > 0) {
            scheduleQueueWorkerWake({
                drainDepth: drainDepth + 1,
                reason: "post_reclaim_empty_claim",
            });
        }
        await cleanupOldJobs(admin);
        await emitQueueMetrics(admin, { processed: 0, failed: 0, coalesced: 0, reclaimed });
        return NextResponse.json({
            ok: true,
            processed: 0,
            reclaimed,
            drainDepth,
            ms: Date.now() - t0,
        });
    }

    // Busca detalhes dos jobs claimados
    const { data: jobs } = await admin.from("chatbot_queue").select("*").in("id", jobIds);

    const jobList = interleaveQueueJobsByCompany((jobs ?? []) as ChatbotQueueJobRow[]);

    const counters: QueueBatchCounters = { processed: 0, failed: 0, coalesced: 0 };
    const seenInBatch = new Set<string>();

    for (const job of jobList) {
        const outcome = await runQueueEntryWithOutcome(admin, job, seenInBatch);
        tally(counters, outcome);
    }

    await cleanupOldJobs(admin);

    // Self-wake: batch cheio OU claim parcial com pending (fairness / skip-busy thread)
    let continued = false;
    {
        const { count: pendingLeft } = await admin
            .from("chatbot_queue")
            .select("id", { count: "exact", head: true })
            .eq("status", "pending")
            .lt("attempts", MAX_ATTEMPTS)
            .lte("scheduled_at", new Date().toISOString());
        const shouldContinue =
            (pendingLeft ?? 0) > 0 && (jobIds.length >= BATCH_SIZE || jobIds.length > 0);
        if (shouldContinue) {
            scheduleQueueWorkerWake({
                drainDepth: drainDepth + 1,
                reason: jobIds.length >= BATCH_SIZE ? "self_drain" : "self_drain_partial_fair",
            });
            continued = true;
        }
    }

    await emitQueueMetrics(admin, {
        ...counters,
        reclaimed,
        claimed: jobIds.length,
        continued,
    });

    return NextResponse.json({
        ok: true,
        processed: counters.processed,
        coalesced: counters.coalesced,
        failed: counters.failed,
        reclaimed,
        claimed: jobIds.length,
        drainDepth,
        continued,
        ms: Date.now() - t0,
    });
}

// ─── Fallback sem RPC (sem garantia de exclusividade entre instâncias) ─────────

async function runFallbackProcessing(admin: AdminClient, t0: number) {
    const { data: jobs } = await admin
        .from("chatbot_queue")
        .select("*")
        .eq("status", "pending")
        .lt("attempts", MAX_ATTEMPTS)
        .order("scheduled_at", { ascending: true })
        .limit(BATCH_SIZE);

    if (!jobs?.length) {
        await cleanupOldJobs(admin);
        await emitQueueMetrics(admin, { processed: 0, failed: 0, coalesced: 0 });
        return NextResponse.json({ ok: true, processed: 0, ms: Date.now() - t0 });
    }

    const counters: QueueBatchCounters = { processed: 0, failed: 0, coalesced: 0 };
    const seenInBatch = new Set<string>();
    const fallbackJobList = interleaveQueueJobsByCompany(jobs as ChatbotQueueJobRow[]);

    for (const job of fallbackJobList) {
        const outcome = await runQueueEntryWithOutcome(admin, job, seenInBatch, {
            markProcessingBeforeRun: true,
            sentryRoute: "process-queue-fallback",
        });
        tally(counters, outcome);
    }

    await cleanupOldJobs(admin);
    await emitQueueMetrics(admin, counters);
    return NextResponse.json({ ok: true, ...counters, ms: Date.now() - t0 });
}

async function handleClaimError(
    admin: AdminClient,
    t0: number,
    claimErr: { message?: string } | null
) {
    const message = claimErr?.message ?? "claim rpc unavailable";
    if (!ALLOW_CLAIM_FALLBACK) {
        console.error("[process-queue] RPC claim_chatbot_queue_jobs indisponível em modo fail-fast:", message);
        await emitQueueMetrics(admin, { processed: 0, failed: 1, coalesced: 0 });
        return NextResponse.json(
            { ok: false, error: "claim_rpc_unavailable", failed: 1, ms: Date.now() - t0 },
            { status: 503 }
        );
    }

    // Fallback só fora de produção (em prod o claim RPC é obrigatório).
    console.warn("[process-queue] RPC claim_chatbot_queue_jobs não encontrada, usando fallback:", message);
    return runFallbackProcessing(admin, t0);
}
