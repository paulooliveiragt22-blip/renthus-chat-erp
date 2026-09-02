import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
    buildSqsEnvelope,
    isSqsDispatchEnabled,
    messageGroupIdFor,
    resolveInboundQueueUrl,
    resolveOutboundQueueUrl,
    resetSqsClientForTests,
} from "../../lib/queue/sqsDispatch";

describe("sqsDispatch", () => {
    const prev: Record<string, string | undefined> = {};

    beforeEach(() => {
        for (const k of [
            "SQS_DISPATCH_ENABLED",
            "SQS_INBOUND_QUEUE_URL",
            "SQS_OUTBOUND_QUEUE_URL",
            "AWS_REGION",
        ]) {
            prev[k] = process.env[k];
        }
        resetSqsClientForTests();
    });

    afterEach(() => {
        for (const [k, v] of Object.entries(prev)) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
        resetSqsClientForTests();
    });

    it("isSqsDispatchEnabled only when SQS_DISPATCH_ENABLED=1", () => {
        delete process.env.SQS_DISPATCH_ENABLED;
        assert.strictEqual(isSqsDispatchEnabled(), false);
        process.env.SQS_DISPATCH_ENABLED = "0";
        assert.strictEqual(isSqsDispatchEnabled(), false);
        process.env.SQS_DISPATCH_ENABLED = "1";
        assert.strictEqual(isSqsDispatchEnabled(), true);
    });

    it("buildSqsEnvelope v1 contract — outbound (Fase 13: inbound removido)", () => {
        const env = buildSqsEnvelope(
            {
                kind: "outbound",
                jobId: "job-1",
                companyId: "co-1",
                threadId: "th-1",
            },
            "2026-08-28T20:00:00.000Z"
        );
        assert.deepStrictEqual(env, {
            v: 1,
            kind: "outbound",
            jobId: "job-1",
            companyId: "co-1",
            threadId: "th-1",
            enqueuedAt: "2026-08-28T20:00:00.000Z",
        });
    });

    it("messageGroupId: outbound=company (Fase 13: inbound=thread não existe mais)", () => {
        assert.strictEqual(
            messageGroupIdFor({
                kind: "outbound",
                jobId: "j",
                companyId: "c",
                threadId: "t",
            }),
            "c"
        );
        assert.strictEqual(
            messageGroupIdFor({
                kind: "outbound",
                jobId: "j",
                companyId: "c",
                threadId: "t",
            }),
            "c"
        );
    });

    it("resolves queue URLs from env", () => {
        process.env.SQS_INBOUND_QUEUE_URL = "https://sqs.example/in.fifo";
        process.env.SQS_OUTBOUND_QUEUE_URL = "https://sqs.example/out.fifo";
        assert.strictEqual(resolveInboundQueueUrl(), "https://sqs.example/in.fifo");
        assert.strictEqual(resolveOutboundQueueUrl(), "https://sqs.example/out.fifo");
    });
});
