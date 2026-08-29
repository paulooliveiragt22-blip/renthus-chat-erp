/**
 * Núcleo do worker inbound — reutilizável por process-queue HTTP e Lambda SQS (ADR-0003).
 */

import "server-only";
import {
    runQueueEntryWithOutcome,
    type QueueEntryOutcome,
    type RunQueueEntryOptions,
} from "./runQueueEntry";
import type { AdminClient, ChatbotQueueJobRow } from "./types";

export type ProcessInboundJobResult =
    | { ok: true; outcome: QueueEntryOutcome; job: ChatbotQueueJobRow }
    | { ok: false; error: "job_not_found" | "job_not_runnable"; jobId: string };

/**
 * Carrega job por id e executa `runQueueEntryWithOutcome`.
 * Por padrão marca processing antes (caminho SQS / sem claim RPC).
 */
export async function processInboundJobById(
    admin: AdminClient,
    jobId: string,
    opts?: RunQueueEntryOptions & { seenInBatch?: Set<string> }
): Promise<ProcessInboundJobResult> {
    const { data, error } = await admin
        .from("chatbot_queue")
        .select("*")
        .eq("id", jobId)
        .maybeSingle();

    if (error) {
        console.error("[processInboundJobById] select failed", jobId, error.message);
        return { ok: false, error: "job_not_found", jobId };
    }
    if (!data) {
        return { ok: false, error: "job_not_found", jobId };
    }

    const job = data as ChatbotQueueJobRow;
    if (job.status === "done" || job.status === "failed") {
        return { ok: false, error: "job_not_runnable", jobId };
    }

    const seenInBatch = opts?.seenInBatch ?? new Set<string>();
    const outcome = await runQueueEntryWithOutcome(admin, job, seenInBatch, {
        markProcessingBeforeRun: opts?.markProcessingBeforeRun ?? true,
        sentryRoute: opts?.sentryRoute ?? "sqs-inbound-worker",
    });

    return { ok: true, outcome, job };
}
