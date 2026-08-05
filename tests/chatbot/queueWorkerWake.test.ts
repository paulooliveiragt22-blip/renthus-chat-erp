import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getQueueDrainMaxDepth } from "../../lib/chatbot/queueWorkerWake";

describe("queueWorkerWake", () => {
    it("drain max default entre 1 e 20", () => {
        const n = getQueueDrainMaxDepth();
        assert.ok(n >= 1 && n <= 20);
    });
});
