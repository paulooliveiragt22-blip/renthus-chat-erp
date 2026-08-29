/**
 * Pós-enqueue outbox (ADR-0003) — só SQS; wake HTTP removido na Fase 4.
 */

import "server-only";
import { after } from "next/server";
import type { AdminClient } from "@/lib/chatbot/queue/types";
import {
    dispatchInboundJob,
    dispatchOutboundJob,
    isSqsDispatchEnabled,
} from "@/lib/queue/sqsDispatch";

type JobRef = { id: string; company_id: string; thread_id: string };

/** Dispara após insert em chatbot_queue (fire-and-forget via after). */
export function scheduleInboundAfterEnqueue(
    admin: AdminClient,
    job: JobRef,
    reason = "inbound_enqueue"
): void {
    after(() => {
        void (async () => {
            if (!isSqsDispatchEnabled()) {
                console.warn("[afterEnqueue] SQS dispatch disabled — job pending until reconciler", {
                    jobId: job.id,
                    reason,
                });
                return;
            }
            try {
                await dispatchInboundJob(admin, job);
            } catch (err: unknown) {
                console.warn(
                    "[afterEnqueue] inbound dispatch:",
                    err instanceof Error ? err.message : err
                );
            }
        })();
    });
}

/** Dispara após enqueue em outbound_jobs (um ou vários job ids). */
export function scheduleOutboundAfterEnqueue(
    admin: AdminClient,
    jobs: JobRef[],
    reason = "outbound_enqueue"
): void {
    after(() => {
        void (async () => {
            if (!isSqsDispatchEnabled()) {
                console.warn("[afterEnqueue] SQS dispatch disabled — outbound pending", {
                    count: jobs.length,
                    reason,
                });
                return;
            }
            for (const job of jobs) {
                try {
                    await dispatchOutboundJob(admin, job);
                } catch (err: unknown) {
                    console.warn(
                        "[afterEnqueue] outbound dispatch:",
                        job.id,
                        err instanceof Error ? err.message : err
                    );
                }
            }
        })();
    });
}

/**
 * Outbound quando só sabemos que houve enqueue (sem ids).
 * Com dispatch on: busca pending recentes sem sqs_enqueued_at.
 */
export function scheduleOutboundAfterEnqueueLookup(
    admin: AdminClient,
    opts: {
        companyId?: string;
        dedupKeys?: string[];
        reason?: string;
        limit?: number;
    }
): void {
    after(() => {
        void (async () => {
            const reason = opts.reason ?? "outbound_enqueue";
            if (!isSqsDispatchEnabled()) {
                console.warn("[afterEnqueue] SQS dispatch disabled — outbound lookup skipped", {
                    reason,
                });
                return;
            }

            let q = admin
                .from("outbound_jobs")
                .select("id, company_id, thread_id")
                .eq("status", "pending")
                .is("sqs_enqueued_at", null)
                .order("created_at", { ascending: false })
                .limit(opts.limit ?? 50);

            if (opts.companyId) q = q.eq("company_id", opts.companyId);
            if (opts.dedupKeys?.length) q = q.in("dedup_key", opts.dedupKeys);

            const { data, error } = await q;
            if (error) {
                console.warn("[afterEnqueue] outbound lookup:", error.message);
                return;
            }

            for (const job of (data ?? []) as JobRef[]) {
                try {
                    await dispatchOutboundJob(admin, job);
                } catch (err: unknown) {
                    console.warn(
                        "[afterEnqueue] outbound dispatch:",
                        job.id,
                        err instanceof Error ? err.message : err
                    );
                }
            }
        })();
    });
}
