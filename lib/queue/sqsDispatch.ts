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
    const fromEnv = process.env.AWS_REGION?.trim() || process.env.AWS_DEFAULT_REGION?.trim();
    if (fromEnv) return fromEnv;
    return "sa-east-1";
}

function getSqsClient(): SQSClient | null {
    if (cachedClient) return cachedClient;
    const region = resolveAwsRegion();

    // AWS SDK v3: sem `credentials` explícito, o cliente busca via cadeia de providers:
    //   1. env vars (AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY) — funciona em Lambda SOMENTE se já houver
    //   2. ~/.aws/credentials (AWS CLI profile) — funciona em dev local, NÃO na Vercel
    //   3. EC2/ECS/Lambda instance metadata — só funciona em compute AWS
    //
    // Vercel NÃO é AWS: roda Node.js puro em container serverless sem IAM Role.
    // Sem credentials explícitas, SQSClient falha silenciosamente em runtime.
    //
    // Workaround: se as env vars existirem (caso Vercel), passar credentials explícitas.
    // Em Lambda, deixa o SDK pegar via IAM Role automaticamente.
    const config: SQSClientConfig = { region };
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();
    if (accessKeyId && secretAccessKey) {
        config.credentials = { accessKeyId, secretAccessKey };
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
 * Fase 14 — MessageGroupId strategy:
 *  - inbound: `company_id` (NÃO `thread_id`) — evita bloqueio FIFO por thread individual.
 *    Cliente com5 msgs em30s em threads diferentes → grupos separados, não bloqueia.
 *    Ordem por thread pode ser preservada via Postgres `thread_locks` RPC (opcional).
 *  - outbound: `company_id` (igual à Fase 0-12).
 */
export function messageGroupIdFor(input: DispatchJobInput): string {
    return input.companyId;
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

export function resetSqsClientForTests(): void {
    cachedClient = null;
}