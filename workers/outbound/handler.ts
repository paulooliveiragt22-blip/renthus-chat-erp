/**
 * Lambda handler — SQS FIFO outbound → processOutboundJobById (ADR-0003).
 */

import type { SQSEvent, SQSBatchResponse, SQSRecord } from "aws-lambda";
import { createAdminClient } from "@/lib/supabase/admin";
import { processOutboundJobById } from "@/lib/chatbot/outbound/processOutboundJobById";
import {
    CompanyWorkerCapError,
    runWithCompanyWorkerCap,
} from "@/lib/chatbot/queue/companyWorkerCap";
import { parseSqsEnvelope } from "@/lib/queue/sqsEnvelope";
import { applySqsRetryVisibility } from "../shared/sqsRetryVisibility";

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
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
    if (!envelope || envelope.kind !== "outbound") {
        console.error("[outbound-worker] invalid envelope", {
            messageId: record.messageId,
            body: String(record.body ?? "").slice(0, 200),
        });
        return true;
    }

    const queueUrl = process.env.SQS_OUTBOUND_QUEUE_URL?.trim();

    try {
        const result = await runWithCompanyWorkerCap({
            companyId: envelope.companyId,
            fn: () => processOutboundJobById(admin, envelope.jobId),
        });

        if (!result.ok) {
            if (result.error === "job_not_found" || result.error === "job_not_runnable") {
                console.info("[outbound-worker] skip", result);
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
                .from("outbound_jobs")
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

        console.info("[outbound-worker] done", {
            jobId: envelope.jobId,
            outcome: result.outcome,
        });
        return true;
    } catch (err: unknown) {
        if (err instanceof CompanyWorkerCapError) {
            console.warn("[outbound-worker] company cap", err.message);
            await applySqsRetryVisibility({
                queueUrl,
                receiptHandle: record.receiptHandle,
                attempts: 1,
            });
            return false;
        }
        console.error(
            "[outbound-worker] error",
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
