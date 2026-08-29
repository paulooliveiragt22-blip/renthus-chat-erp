/**
 * Dispatch de jobs outbox → SQS FIFO (ADR-0003).
 * Ativo só com SQS_DISPATCH_ENABLED=1 e URLs + credenciais AWS.
 * Sem env → no-op (dev/test).
 */

import "server-only";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import type { AdminClient } from "@/lib/chatbot/queue/types";
import type { SqsEnvelopeV1, SqsJobKind } from "@/lib/queue/sqsEnvelope";

export type { SqsEnvelopeV1, SqsJobKind } from "@/lib/queue/sqsEnvelope";
export { parseSqsEnvelope } from "@/lib/queue/sqsEnvelope";

export type DispatchJobInput = {
    kind: SqsJobKind;
    jobId: string;
    companyId: string;
    threadId: string;
};

export type DispatchResult =
    | { ok: true; skipped: true; reason: "dispatch_disabled" | "missing_config" }
    | { ok: true; skipped: false; messageId: string }
    | { ok: false; error: string };

let cachedClient: SQSClient | null = null;

export function isSqsDispatchEnabled(): boolean {
    return process.env.SQS_DISPATCH_ENABLED?.trim() === "1";
}

export function resolveInboundQueueUrl(): string {
    return process.env.SQS_INBOUND_QUEUE_URL?.trim() ?? "";
}

export function resolveOutboundQueueUrl(): string {
    return process.env.SQS_OUTBOUND_QUEUE_URL?.trim() ?? "";
}

function resolveAwsRegion(): string {
    return process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim() || "sa-east-1";
}

function getSqsClient(): SQSClient {
    if (!cachedClient) {
        cachedClient = new SQSClient({ region: resolveAwsRegion() });
    }
    return cachedClient;
}

/** Test helper — reset client cache. */
export function resetSqsClientForTests(): void {
    cachedClient = null;
}

export function buildSqsEnvelope(input: DispatchJobInput, enqueuedAt = new Date().toISOString()): SqsEnvelopeV1 {
    return {
        v: 1,
        kind: input.kind,
        jobId: input.jobId,
        companyId: input.companyId,
        threadId: input.threadId,
        enqueuedAt,
    };
}

export function messageGroupIdFor(input: DispatchJobInput): string {
    return input.kind === "inbound" ? input.threadId : input.companyId;
}

function queueUrlFor(kind: SqsJobKind): string {
    return kind === "inbound" ? resolveInboundQueueUrl() : resolveOutboundQueueUrl();
}

function outboxTable(kind: SqsJobKind): "chatbot_queue" | "outbound_jobs" {
    return kind === "inbound" ? "chatbot_queue" : "outbound_jobs";
}

/**
 * SendMessage SQS + marca sqs_enqueued_at na outbox.
 * Fail-soft: erros de rede não lançam — caller decide se loga/reconciliation.
 */
export async function dispatchChatbotJob(
    admin: AdminClient,
    input: DispatchJobInput
): Promise<DispatchResult> {
    if (!isSqsDispatchEnabled()) {
        return { ok: true, skipped: true, reason: "dispatch_disabled" };
    }

    const queueUrl = queueUrlFor(input.kind);
    if (!queueUrl) {
        console.warn("[sqsDispatch] missing queue URL", { kind: input.kind });
        return { ok: true, skipped: true, reason: "missing_config" };
    }

    const envelope = buildSqsEnvelope(input);
    try {
        const res = await getSqsClient().send(
            new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(envelope),
                MessageGroupId: messageGroupIdFor(input),
                MessageDeduplicationId: input.jobId,
            })
        );
        const messageId = res.MessageId?.trim() ?? "";
        if (!messageId) {
            return { ok: false, error: "sqs_missing_message_id" };
        }

        const { error } = await admin
            .from(outboxTable(input.kind))
            .update({
                sqs_enqueued_at: envelope.enqueuedAt,
                sqs_message_id: messageId,
            })
            .eq("id", input.jobId);

        if (error) {
            console.error("[sqsDispatch] outbox stamp failed", {
                jobId: input.jobId,
                messageId,
                error: error.message,
            });
            // Message already in SQS — reconciler can ignore stamp later.
            return { ok: true, skipped: false, messageId };
        }

        return { ok: true, skipped: false, messageId };
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[sqsDispatch] SendMessage failed", {
            kind: input.kind,
            jobId: input.jobId,
            error: message,
        });
        return { ok: false, error: message.slice(0, 500) };
    }
}

export async function dispatchInboundJob(
    admin: AdminClient,
    job: { id: string; company_id: string; thread_id: string }
): Promise<DispatchResult> {
    return dispatchChatbotJob(admin, {
        kind: "inbound",
        jobId: job.id,
        companyId: job.company_id,
        threadId: job.thread_id,
    });
}

export async function dispatchOutboundJob(
    admin: AdminClient,
    job: { id: string; company_id: string; thread_id: string }
): Promise<DispatchResult> {
    return dispatchChatbotJob(admin, {
        kind: "outbound",
        jobId: job.id,
        companyId: job.company_id,
        threadId: job.thread_id,
    });
}
