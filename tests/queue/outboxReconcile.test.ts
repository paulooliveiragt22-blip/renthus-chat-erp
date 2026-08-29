import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { reconcileOutbox } from "../../lib/queue/outboxReconcile";
import { makeMockAdmin } from "../helpers/mockSupabaseAdmin";
import type { AdminClient } from "@/lib/chatbot/queue/types";

describe("outboxReconcile", () => {
    const prev: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const k of ["SQS_DISPATCH_ENABLED", "SQS_INBOUND_QUEUE_URL", "SQS_OUTBOUND_QUEUE_URL"]) {
            prev[k] = process.env[k];
        }
        process.env.SQS_DISPATCH_ENABLED = "1";
        delete process.env.SQS_INBOUND_QUEUE_URL;
        delete process.env.SQS_OUTBOUND_QUEUE_URL;
    });

    afterEach(() => {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });

    it("reclaim inbound processing stale → pending", async () => {
        const stale = new Date(Date.now() - 10 * 60_000).toISOString();
        const { client, tables } = makeMockAdmin({
            chatbot_queue: [
                {
                    id: "job-stuck",
                    company_id: "co-1",
                    thread_id: "th-1",
                    status: "processing",
                    attempts: 1,
                    processing_started_at: stale,
                    scheduled_at: stale,
                    created_at: stale,
                    sqs_enqueued_at: "2026-08-28T12:00:00.000Z",
                },
            ],
            outbound_jobs: [],
        });

        const stats = await reconcileOutbox(client as unknown as AdminClient, {
            staleProcessingMinutes: 3,
            neverEnqueuedMinAgeMs: 999_999_999,
        });

        assert.equal(stats.inboundStuckReclaimed, 1);
        assert.equal(tables.chatbot_queue[0].status, "pending");
        assert.equal(tables.chatbot_queue[0].sqs_enqueued_at, null);
    });

    it("no-op quando SQS dispatch desligado", async () => {
        process.env.SQS_DISPATCH_ENABLED = "0";
        const { client } = makeMockAdmin({ chatbot_queue: [], outbound_jobs: [] });
        const stats = await reconcileOutbox(client as unknown as AdminClient);
        assert.deepEqual(stats, {
            inboundNeverEnqueued: 0,
            outboundNeverEnqueued: 0,
            inboundStuckReclaimed: 0,
            outboundStuckReclaimed: 0,
            dispatchErrors: 0,
        });
    });
});
