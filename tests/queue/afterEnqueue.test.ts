import assert from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import { isSqsDispatchEnabled } from "../../lib/queue/sqsDispatch";

describe("afterEnqueue (SQS-only Fase 4)", () => {
    const prev: Record<string, string | undefined> = {};

    beforeEach(() => {
        prev.SQS_DISPATCH_ENABLED = process.env.SQS_DISPATCH_ENABLED;
    });

    afterEach(() => {
        if (prev.SQS_DISPATCH_ENABLED === undefined) delete process.env.SQS_DISPATCH_ENABLED;
        else process.env.SQS_DISPATCH_ENABLED = prev.SQS_DISPATCH_ENABLED;
    });

    it("dispatch off by default in dev/test", () => {
        delete process.env.SQS_DISPATCH_ENABLED;
        assert.strictEqual(isSqsDispatchEnabled(), false);
    });

    it("dispatch on when SQS_DISPATCH_ENABLED=1", () => {
        process.env.SQS_DISPATCH_ENABLED = "1";
        assert.strictEqual(isSqsDispatchEnabled(), true);
    });
});
