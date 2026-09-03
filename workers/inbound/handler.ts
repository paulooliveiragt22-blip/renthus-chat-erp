/**
 * Lambda handler — SQS FIFO inbound → processInboundJobById (ADR-0003).
 *
 * MessageGroupId = thread_id (ADR canônico 2026-08-28; revert da Fase 14 em 2026-09-02).
 * Mantidos: Provisioned Concurrency=1 no alias :live, VisibilityTimeout=120s, maxReceiveCount=1.
 * Fase 15: ESM deve invocar renthus-inbound-worker:live (nao $LATEST).
 * Fase 15.3 #5: keep-warm EventBridge (poller ESM) — sentinel sem Records.
 */

import type { SQSEvent, SQSBatchResponse, SQSRecord } from "aws-lambda";
import { createAdminClient } from "@/lib/supabase/admin";
import { processInboundJobById } from "@/lib/chatbot/queue/processInboundJobById";
import {
    CompanyWorkerCapError,
    runWithCompanyWorkerCap,
} from "@/lib/chatbot/queue/companyWorkerCap";
import { parseSqsEnvelope } from "@/lib/queue/sqsEnvelope";
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
                .select("status, attempts")
                .eq("id", envelope.jobId)
                .maybeSingle();
            if (data?.status === "pending") {
                await applySqsRetryVisibility({
                    queueUrl,
                    receiptHandle: record.receiptHandle,
                    attempts: Number(data.attempts ?? 1) || 1,
                });
                return false;
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
