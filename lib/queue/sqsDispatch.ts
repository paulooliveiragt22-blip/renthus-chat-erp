/**
 * lib/queue/sqsDispatch.ts
 *
 * ADR-0003 Fase 14 — RESTAURADO para inbound + outbound.
 *
 * O dispatchInboundJob (Fase 13 havia removido) agora está de volta. O fluxo completo:
 *   Vercel webhook → after() → SendMessage SQS → ESM → Lambda.
 *
 * Sem dual path: NÃO há mais "lambdaInvoker". O único caminho é SQS.
 */

import "server-only";
import { SQSClient, SendMessageCommand, type SQSClientConfig } from "@aws-sdk/client-sqs";
import type { AdminClient } from "@/lib/chatbot/queue/types";
import type { SqsEnvelopeV1, SqsJobKind } from "./sqsEnvelope";

export type { SqsEnvelopeV1, SqsJobKind } from "./sqsEnvelope";
export { parseSqsEnvelope } from "./sqsEnvelope";

export type DispatchJobInput = {
    kind: SqsJobKind;
    jobId: string;
    companyId: string;
    threadId: string;
    /**
     * FIFO: janela de 5 min. Webhook usa só `jobId` (idempotência).
     * Retry/reconcile PRECISA de salt — senão SendMessage “ok” não entrega mensagem nova.
     */
    deduplicationSalt?: string | null;
};

/** Dedup id SQS FIFO (máx. 128). Sem salt = jobId (primeiro enqueue). */
export function fifoDeduplicationId(jobId: string, salt?: string | null): string {
    const id = String(jobId ?? "").trim();
    const s = String(salt ?? "").trim();
    const raw = s ? `${id}:${s}` : id;
    return raw.slice(0, 128);
}

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
    const fromEnv = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
    if (fromEnv) return fromEnv;
    return "sa-east-1";
}

function getSqsClient(): SQSClient | null {
    if (cachedClient) return cachedClient;
    const region = resolveAwsRegion();

    // AWS SDK v3 default credential chain:
    //   env → shared config → IMDS / Lambda execution role
    //
    // Em Lambda NÃO passar credentials explícitas: o runtime injeta
    // AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_SESSION_TOKEN temporários.
    // Se passarmos só accessKeyId/secretAccessKey (sem sessionToken), o SQS
    // responde "The security token included in the request is invalid".
    //
    // Vercel/local: não há IAM Role — aí sim usamos chaves estáticas das env.
    const config: SQSClientConfig = { region };
    const onLambda = Boolean(
        process.env.AWS_LAMBDA_FUNCTION_NAME?.trim() ||
            process.env.AWS_EXECUTION_ENV?.trim()
    );
    if (!onLambda) {
        const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
        const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
        if (accessKeyId && secretAccessKey) {
            const sessionToken = process.env.AWS_SESSION_TOKEN?.trim();
            config.credentials = {
                accessKeyId,
                secretAccessKey,
                ...(sessionToken ? { sessionToken } : {}),
            };
        }
    }

    cachedClient = new SQSClient(config);
    return cachedClient;
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

/**
 * ADR-0003 canônico — MessageGroupId:
 *  - inbound: `thread_id` (isolamento por conversa; falha não serializa a empresa)
 *  - outbound: `company_id` (ordem/proativo por loja)
 *
 * Fase 14 havia trocado inbound → company_id (diagnóstico incorreto de latência).
 * Revertido 2026-09-02 por decisão do owner — volta ao ADR original aceito 2026-08-28.
 */
export function messageGroupIdFor(input: DispatchJobInput): string {
    return input.kind === "inbound" ? input.threadId : input.companyId;
}

function queueUrlFor(kind: SqsJobKind): string {
    return kind === "outbound" ? resolveOutboundQueueUrl() : resolveInboundQueueUrl();
}

function outboxTable(kind: SqsJobKind): "chatbot_queue" | "outbound_jobs" {
    return kind === "outbound" ? "outbound_jobs" : "chatbot_queue";
}

/**
 * SendMessage SQS + marca outbox stamp.
 * Restaurado na Fase 14 — funciona para inbound e outbound.
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
        const client = getSqsClient();
        if (!client) {
            return { ok: false, error: "sqs_client_unavailable" };
        }
        const res = await client.send(
            new SendMessageCommand({
                QueueUrl: queueUrl,
                MessageBody: JSON.stringify(envelope),
                MessageGroupId: messageGroupIdFor(input),
                MessageDeduplicationId: fifoDeduplicationId(input.jobId, input.deduplicationSalt),
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
    job: { id: string; company_id: string; thread_id: string },
    opts?: { deduplicationSalt?: string | null }
): Promise<DispatchResult> {
    return dispatchChatbotJob(admin, {
        kind: "inbound",
        jobId: job.id,
        companyId: job.company_id,
        threadId: job.thread_id,
        deduplicationSalt: opts?.deduplicationSalt,
    });
}

export async function dispatchOutboundJob(
    admin: AdminClient,
    job: { id: string; company_id: string; thread_id: string },
    opts?: { deduplicationSalt?: string | null }
): Promise<DispatchResult> {
    return dispatchChatbotJob(admin, {
        kind: "outbound",
        jobId: job.id,
        companyId: job.company_id,
        threadId: job.thread_id,
        deduplicationSalt: opts?.deduplicationSalt,
    });
}

export function resetSqsClientForTests(): void {
    cachedClient = null;
}