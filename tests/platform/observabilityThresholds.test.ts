import assert from "node:assert";
import { describe, it } from "node:test";
import {
    classifyQueueHealth,
    computeDedupHitRate,
    getPlatformAlertThresholds,
    queueCompanySeverity,
} from "../../lib/platform/observabilityThresholds";

describe("observability thresholds", () => {
    it("dedup formula is coalesced / (done + coalesced)", () => {
        assert.strictEqual(computeDedupHitRate(2, 8), 0.2);
        assert.strictEqual(computeDedupHitRate(0, 0), 0);
    });

    it("classifies critical backlog with processing", () => {
        assert.strictEqual(
            classifyQueueHealth({
                failureRate: 0,
                pendingNow: 100,
                processingNow: 950,
                backlogTotal: 1050,
                failedWindow: 0,
                oldestPendingAgeSec: 200,
            }),
            "critical"
        );
    });

    it("company severity uses pending + processing backlog", () => {
        assert.strictEqual(queueCompanySeverity(0, 5, 16), "red");
        assert.strictEqual(queueCompanySeverity(0, 0, 0), "green");
    });

    it("alert thresholds expose failure min count", () => {
        const t = getPlatformAlertThresholds();
        assert.ok(t.queuePendingN > 0);
        assert.ok(t.failureMinCount >= 1);
    });
});
