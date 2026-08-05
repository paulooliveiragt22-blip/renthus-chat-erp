import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    evaluateBacklogPressure,
    shouldSendBacklogNotice,
} from "../../lib/chatbot/backlogNotice";

describe("backlogNotice", () => {
    it("dispara por profundidade", () => {
        const p = evaluateBacklogPressure({
            pendingCount: 10,
            oldestScheduledAt: new Date().toISOString(),
            depthThreshold: 8,
            ageSeconds: 45,
        });
        assert.equal(p.triggered, true);
        assert.equal(p.reason, "depth");
    });

    it("dispara por idade do pending mais antigo", () => {
        const old = new Date(Date.now() - 60_000).toISOString();
        const p = evaluateBacklogPressure({
            pendingCount: 2,
            oldestScheduledAt: old,
            depthThreshold: 8,
            ageSeconds: 45,
            nowMs: Date.now(),
        });
        assert.equal(p.triggered, true);
        assert.equal(p.reason, "age");
        assert.ok(p.oldestAgeSec >= 45);
    });

    it("respeita cooldown por thread", () => {
        const pressure = evaluateBacklogPressure({
            pendingCount: 20,
            oldestScheduledAt: new Date().toISOString(),
            depthThreshold: 8,
        });
        const now = Date.now();
        assert.equal(
            shouldSendBacklogNotice({
                pressure,
                lastNoticeAtIso: new Date(now - 30_000).toISOString(),
                nowMs: now,
                cooldownSec: 120,
            }),
            false
        );
        assert.equal(
            shouldSendBacklogNotice({
                pressure,
                lastNoticeAtIso: new Date(now - 130_000).toISOString(),
                nowMs: now,
                cooldownSec: 120,
            }),
            true
        );
    });
});
