import assert from "node:assert";
import { describe, it } from "node:test";
import { parseSqsEnvelope } from "../../lib/queue/sqsEnvelope";
import { visibilityTimeoutSecondsForAttempts } from "../../workers/shared/sqsRetryVisibility";

describe("sqsEnvelope", () => {
    it("parses valid v1 envelope", () => {
        const raw = JSON.stringify({
            v: 1,
            kind: "inbound",
            jobId: "j1",
            companyId: "c1",
            threadId: "t1",
            enqueuedAt: "2026-08-28T20:00:00.000Z",
        });
        const e = parseSqsEnvelope(raw);
        assert.ok(e);
        assert.strictEqual(e!.kind, "inbound");
        assert.strictEqual(e!.jobId, "j1");
    });

    it("rejects invalid / wrong version", () => {
        assert.strictEqual(parseSqsEnvelope(""), null);
        assert.strictEqual(parseSqsEnvelope("{"), null);
        assert.strictEqual(
            parseSqsEnvelope(JSON.stringify({ v: 2, kind: "inbound", jobId: "j", companyId: "c", threadId: "t", enqueuedAt: "x" })),
            null
        );
        assert.strictEqual(
            parseSqsEnvelope(JSON.stringify({ v: 1, kind: "other", jobId: "j", companyId: "c", threadId: "t", enqueuedAt: "x" })),
            null
        );
    });
});

describe("sqsRetryVisibility", () => {
    it("maps attempts to 1–900 seconds", () => {
        const s1 = visibilityTimeoutSecondsForAttempts(1);
        assert.ok(s1 >= 1 && s1 <= 900);
        const s10 = visibilityTimeoutSecondsForAttempts(10);
        assert.ok(s10 >= 1 && s10 <= 900);
        assert.ok(s10 >= s1);
    });
});
