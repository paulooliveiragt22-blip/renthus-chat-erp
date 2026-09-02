/**
 * workers/shared/sqsRetryVisibility.ts
 *
 * ADR-0003 Fase 14 - Restaurado.
 * Apply ChangeMessageVisibility para retry de mensagens SQS com backoff.
 * Usado pelo inbound worker (workers/inbound/handler.ts) e outbound worker.
 */

import {
    SQSClient,
    ChangeMessageVisibilityCommand,
} from "@aws-sdk/client-sqs";
import { queueRetryDelayMs } from "@/lib/chatbot/queueRetry";

let client: SQSClient | null = null;

function getClient(): SQSClient {
    if (!client) {
        const region =
            process.env.AWS_REGION?.trim() ||
            process.env.AWS_DEFAULT_REGION?.trim() ||
            "sa-east-1";
        client = new SQSClient({ region });
    }
    return client;
}

export function visibilityTimeoutSecondsForAttempts(attempts: number): number {
    const ms = queueRetryDelayMs(attempts);
    return Math.min(900, Math.max(1, Math.ceil(ms / 1000)));
}

export async function applySqsRetryVisibility(params: {
    queueUrl: string | undefined;
    receiptHandle: string | undefined;
    attempts: number;
}): Promise<void> {
    const queueUrl = params.queueUrl?.trim();
    const receiptHandle = params.receiptHandle?.trim();
    if (!queueUrl || !receiptHandle) return;

    const timeout = visibilityTimeoutSecondsForAttempts(params.attempts);
    try {
        await getClient().send(
            new ChangeMessageVisibilityCommand({
                QueueUrl: queueUrl,
                ReceiptHandle: receiptHandle,
                VisibilityTimeout: timeout,
            })
        );
    } catch (err: unknown) {
        console.warn(
            "[sqsRetryVisibility] ChangeMessageVisibility failed",
            err instanceof Error ? err.message : err
        );
    }
}

export function resetSqsRetryClientForTests(): void {
    client = null;
}
