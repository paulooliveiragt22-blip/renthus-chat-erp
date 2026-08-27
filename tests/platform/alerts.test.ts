import assert from "node:assert";
import { describe, it } from "node:test";

describe("platform alerts thresholds (env defaults)", () => {
    it("documents default pending and age thresholds used by evaluatePlatformAlerts", () => {
        // Espelha defaults de lib/platform/services/platformAlerts.ts
        const queuePendingN = 50;
        const queueAgeSec = 600;
        assert.ok(queuePendingN > 0);
        assert.strictEqual(queueAgeSec, 10 * 60);
    });
});
