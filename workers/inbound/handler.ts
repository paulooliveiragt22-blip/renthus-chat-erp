/**
 * Lambda handler — SQS FIFO inbound → processInboundJobById (ADR-0003).
 *
 * MessageGroupId = thread_id (ADR canônico 2026-08-28; revert da Fase 14 em 2026-09-02).
 * Mantidos: Provisioned Concurrency=1 no alias :live, VisibilityTimeout=120s, maxReceiveCount=1.
 * Fase 15: ESM deve invocar renthus-inbound-worker:live (nao $LATEST).
 * Fase 15.3 #5: keep-warm EventBridge (poller ESM) — sentinel sem Records.
 *
 * Retryable (ex.: LLM 429): com maxReceiveCount=1, `return false` manda pra DLQ e o job
 * fica órfão. Padrão correto = ACK (`return true`) + re-dispatch após backoff (job já
 * voltou `pending` com `sqs_enqueued_at=null` em runQueueEntry).
 */

import type { SQSEvent, SQSBatchResponse, SQSRecord } from "aws-lambda";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundJobById } from "@/lib/chatbot/queue/processInboundJobById";
import {
    CompanyWorkerCapError,
    runWithCompanyWorkerCap,
} from "@/lib/chatbot/queue/companyWorkerCap";
import { parseSqsEnvelope } from "@/lib/queue/sqsEnvelope";
import { dispatchInboundJob } from "@/lib/queue/sqsDispatch";
import { queueRetryDelayMs } from "@/lib/chatbot/queueRetry";
import { applySqsRetryVisibility } from "../shared/sqsRetryVisibility";

type KeepWarmResult = { ok: true; mode: "keep-warm" };

function isKeepWarmEvent(event: unknown): boolean {
    if (!event || typeof event !== "object") return false;
    const e = event as Record<string, unknown>;
    if (Array.isArray(e.Records)) return false;
    if (e.source === "renthus.keep-warm") return true;
    if (e.source === "aws.events") return true;
    if (e["detail-type"] === "Scheduled Event") return true;
    return false;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function handler(
    event: SQSEvent | Record<string, unknown>
): Promise<SQSBatchResponse | KeepWarmResult> {
    if (isKeepWarmEvent(event)) {
        return { ok: true, mode: "keep-warm" };
    }

    const sqsEvent = event as SQSEvent;
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    const admin = createAdminClient();

    for (const record of sqsEvent.Records ?? []) {
        const ok = await processRecord(admin, record);
        if (!ok) {
            batchItemFailures.push({ itemIdentifier: record.messageId });
        }
    }

    return { batchItemFailures };
}

async function processRecord(
    admin: ReturnType<typeof createAdminClient>,
    record: SQSRecord
): Promise<boolean> {
    const envelope = parseSqsEnvelope(record.body ?? "");
    if (!envelope || envelope.kind !== "inbound") {
        console.error("[inbound-worker] invalid envelope", {
            messageId: record.messageId,
            body: String(record.body ?? "").slice(0, 200),
        });
        return true;
    }

    const queueUrl = process.env.SQS_INBOUND_QUEUE_URL?.trim();

    try {
        const result = await runWithCompanyWorkerCap({
            companyId: envelope.companyId,
            fn: () =>
                processInboundJobById(admin, envelope.jobId, {
                    markProcessingBeforeRun: true,
                    sentryRoute: "lambda-inbound-worker",
                }),
        });

        if (!result.ok) {
            if (result.error === "job_not_found" || result.error === "job_not_runnable") {
                console.info("[inbound-worker] skip", result);
                return true;
            }
            await applySqsRetryVisibility({
                queueUrl,
                receiptHandle: record.receiptHandle,
                attempts: 1,
            });
            return false;
        }

        if (result.outcome === "failed") {
            const { data } = await admin
                .from("chatbot_queue")
                .select("status, attempts, company_id, thread_id, scheduled_at, last_error")
                .eq("id", envelope.jobId)
                .maybeSingle();
            if (data?.status === "pending") {
                const attempts = Number(data.attempts ?? 1) || 1;
                const lastError = String(data.last_error ?? "");
                const rateLimited = /429|rate limit|circuit_open/i.test(lastError);
                /**
                 * `runQueueEntry` já gravou `scheduled_at` com minMs=35s em 429.
                 * NÃO usar `Math.min(queueRetryDelayMs(attempts), …)`: sem `minMs` o delay
                 * vira ~2s no 1º attempt — re-dispatch com lock Redis de coalesce ainda vivo
                 * → `coalesced_duplicate_inbound` e o pedido some (silêncio no WhatsApp).
                 */
                const scheduledAtMs = data.scheduled_at
                    ? new Date(String(data.scheduled_at)).getTime()
                    : Date.now();
                const fromSchedule = Math.max(0, scheduledAtMs - Date.now());
                const fromAttempts = queueRetryDelayMs(attempts, {
                    minMs: rateLimited ? 35_000 : 0,
                });
                const waitMs = Math.max(fromSchedule, fromAttempts);
                // Cap sleep in-Lambda: VisibilityTimeout=120s; keep headroom.
                // Circuito Groq/Anthropic = 30s; cap antigo 25s reprocessava com circuito ainda aberto.
                const sleepMs = Math.min(waitMs, 50_000);
                if (sleepMs > 0) await sleep(sleepMs);
                const dispatch = await dispatchInboundJob(
                    admin,
                    {
                        id: envelope.jobId,
                        company_id: String(data.company_id ?? envelope.companyId),
                        thread_id: String(data.thread_id ?? envelope.threadId),
                    },
                    { deduplicationSalt: `r${attempts}-${Date.now()}` }
                );
                console.info("[inbound-worker] retryable re-dispatch", {
                    jobId: envelope.jobId,
                    attempts,
                    sleepMs,
                    rateLimited,
                    dispatchOk: dispatch.ok,
                    skipped: "skipped" in dispatch ? dispatch.skipped : undefined,
                    error: dispatch.ok ? undefined : dispatch.error,
                });
                // ACK: não devolver false (maxReceiveCount=1 → DLQ + pending órfão).
                return true;
            }
        }

        console.info("[inbound-worker] done", {
            jobId: envelope.jobId,
            outcome: result.outcome,
        });
        return true;
    } catch (err: unknown) {
        if (err instanceof CompanyWorkerCapError) {
            console.warn("[inbound-worker] company cap", err.message);
            await applySqsRetryVisibility({
                queueUrl,
                receiptHandle: record.receiptHandle,
                attempts: 1,
            });
            return false;
        }
        console.error(
            "[inbound-worker] error",
            envelope.jobId,
            err instanceof Error ? err.message : err
        );
        await applySqsRetryVisibility({
            queueUrl,
            receiptHandle: record.receiptHandle,
            attempts: 1,
        });
        return false;
    }
}
