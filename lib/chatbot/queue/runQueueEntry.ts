import "server-only";
import * as Sentry from "@sentry/nextjs";
import { isQueueRetryableError, queueRetryDelayMs } from "@/lib/chatbot/queueRetry";
import { buildCoalesceKey, hasRecentEquivalentProcessed } from "./coalesce";
import { processQueueJobEntry } from "./processJobEntry";
import { MAX_ATTEMPTS } from "./env";
import type { AdminClient, ChatbotQueueJobRow } from "./types";

export type QueueEntryOutcome = "processed" | "coalesced" | "failed";

export interface RunQueueEntryOptions {
    /** `true` no caminho fallback (sem RPC de claim atômico) — marca `processing`+incrementa
     * `attempts` antes de rodar, já que o claim RPC não fez isso atomicamente. */
    markProcessingBeforeRun?: boolean;
    /** Tag do Sentry pra distinguir caminho principal do fallback nos eventos capturados. */
    sentryRoute?: string;
}

/**
 * Unidade de trabalho de 1 job: coalesce → (marca processing se pedido) → `processQueueJobEntry`
 * → persiste done/failed/retry. Retorna o outcome em vez de mutar um contador por referência —
 * quem chama soma. Iterar sequencialmente (`for`) ou concorrente (Fase 3 de
 * `docs/PLANO_ESCALA_PICOS_PEDIDOS.md`, `runWithConcurrencyLimit`) é decisão de quem chama, não
 * desta função.
 */
export async function runQueueEntryWithOutcome(
    admin: AdminClient,
    job: ChatbotQueueJobRow,
    seenInBatch: Set<string>,
    opts: RunQueueEntryOptions = {}
): Promise<QueueEntryOutcome> {
    const { markProcessingBeforeRun = false, sentryRoute = "process-queue" } = opts;

    const coalesceKey = buildCoalesceKey(
        job.thread_id,
        job.phone_e164,
        job.company_id,
        job.body_text,
        job.metadata?.message_type ?? null
    );
    const shouldCoalesce =
        !!coalesceKey &&
        (seenInBatch.has(coalesceKey) || (await hasRecentEquivalentProcessed(admin, job, coalesceKey)));

    if (shouldCoalesce) {
        console.info("[process-queue] inbound coalesced", {
            companyId: job.company_id,
            threadId: job.thread_id,
            messageId: job.message_id,
            body: String(job.body_text ?? "").slice(0, 64),
            messageType: job.metadata?.message_type ?? null,
        });
        await admin
            .from("chatbot_queue")
            .update({ status: "done", last_error: "coalesced_duplicate_inbound" })
            .eq("id", job.id);
        return "coalesced";
    }

    if (coalesceKey) seenInBatch.add(coalesceKey);

    if (markProcessingBeforeRun) {
        await admin
            .from("chatbot_queue")
            .update({ status: "processing", attempts: (job.attempts ?? 0) + 1 })
            .eq("id", job.id);
    }

    try {
        await processQueueJobEntry(admin, job);
        await admin.from("chatbot_queue").update({ status: "done" }).eq("id", job.id);
        return "processed";
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[${sentryRoute}] job falhou:`, job.id, message);
        Sentry.captureException(err, {
            tags: { companyId: job.company_id, threadId: job.thread_id, route: sentryRoute },
        });
        const attempts = (job.attempts ?? 0) + 1;
        const retryable = isQueueRetryableError(err);
        const delayMs = retryable ? queueRetryDelayMs(attempts) : 0;
        const terminal = attempts >= MAX_ATTEMPTS;
        await admin
            .from("chatbot_queue")
            .update({
                status: terminal ? "failed" : "pending",
                last_error: message.slice(0, 500),
                ...(terminal
                    ? {}
                    : {
                          scheduled_at: new Date(Date.now() + delayMs).toISOString(),
                          processing_started_at: null,
                      }),
            })
            .eq("id", job.id);
        return "failed";
    }
}
