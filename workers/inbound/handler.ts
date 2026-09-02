/**
 * Lambda handler — SQS FIFO inbound → processInboundJobById (ADR-0003).
 *
 * Fase 14: voltou a ser handler SQS (a Fase 13 com Lambda direto foi revertida
 * pelo owner — ver ADR-0003 § 14). SQS FIFO garante ordem por thread; combinado
 * com `MessageGroupId=company_id`, Provisioned Concurrency=1, VisibilityTimeout=60s,
 * maxReceiveCount=1, e aiTimeoutMs=12s, a latência alvo é p95 <5s.
 *
 * Comportamento:
 *  1. Parse envelope SQS ({v:1, kind:"inbound", jobId, companyId, threadId}).
 *  2. processInboundJobById (idempotente; thread lock via Postgres opcional).
 *  3. Se falhar: ReportBatchItemFailure → SQS aplica retry visibility (ChangeMessageVisibility).
 *  4. Se maxReceiveCount atingido: mensagem vai para DLQ automática.
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

type HandlerEvent = SQSEvent;

export async function handler(event: HandlerEvent): Promise<SQSBatchResponse> {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    const admin = createAdminClient();

    for (const record of event.Records ?? []) {
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
