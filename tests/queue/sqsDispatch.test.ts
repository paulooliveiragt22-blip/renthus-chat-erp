import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
    buildSqsEnvelope,
    fifoDeduplicationId,
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

    it("buildSqsEnvelope v1 contract", () => {
        const env = buildSqsEnvelope(
            {
                kind: "inbound",
                jobId: "job-1",
                companyId: "co-1",
                threadId: "th-1",
            },
            "2026-08-28T20:00:00.000Z"
        );
        assert.deepStrictEqual(env, {
            v: 1,
            kind: "inbound",
            jobId: "job-1",
            companyId: "co-1",
            threadId: "th-1",
            enqueuedAt: "2026-08-28T20:00:00.000Z",
        });
    });

    it("messageGroupId: inbound=thread, outbound=company (ADR-0003 canônico)", () => {
        assert.strictEqual(
            messageGroupIdFor({
                kind: "inbound",
                jobId: "j",
                companyId: "c",
                threadId: "t",
            }),
            "t"
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

    it("fifoDeduplicationId: primeiro enqueue = jobId; retry muda o id", () => {
        assert.strictEqual(fifoDeduplicationId("job-1"), "job-1");
        assert.strictEqual(fifoDeduplicationId("job-1", "r1-9"), "job-1:r1-9");
        assert.notStrictEqual(fifoDeduplicationId("job-1"), fifoDeduplicationId("job-1", "r1"));
    });

    it("resolves queue URLs from env", () => {
        process.env.SQS_INBOUND_QUEUE_URL = "https://sqs.example/in.fifo";
        process.env.SQS_OUTBOUND_QUEUE_URL = "https://sqs.example/out.fifo";
        assert.strictEqual(resolveInboundQueueUrl(), "https://sqs.example/in.fifo");
        assert.strictEqual(resolveOutboundQueueUrl(), "https://sqs.example/out.fifo");
    });
});
