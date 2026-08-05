import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    bumpAiTurnCount,
    hasAiTurnLimit,
    isAiTurnLimitExceeded,
    isInfoOnlyMode,
    parseAiOrderModePolicy,
    resolveAiTurnWindow,
} from "../../lib/chatbot/aiOrderModePolicy";

describe("aiOrderModePolicy", () => {
    it("defaults to close_orders with unlimited turns", () => {
        const p = parseAiOrderModePolicy(null);
        assert.equal(p.mode, "close_orders");
        assert.equal(p.sessionIdleMinutes, 120);
        assert.equal(p.aiSessionWindowMinutes, 60);
        assert.equal(p.aiMaxTurnsPerSession, 0);
        assert.equal(hasAiTurnLimit(p), false);
        assert.equal(isInfoOnlyMode(p), false);
    });

    it("parses info_only with max turns", () => {
        const p = parseAiOrderModePolicy({
            ai_order_mode: "info_only",
            session_idle_minutes: 90,
            ai_session_window_minutes: 30,
            ai_max_turns_per_session: 5,
        });
        assert.equal(p.mode, "info_only");
        assert.equal(p.sessionIdleMinutes, 90);
        assert.equal(p.aiSessionWindowMinutes, 30);
        assert.equal(p.aiMaxTurnsPerSession, 5);
        assert.equal(hasAiTurnLimit(p), true);
    });

    it("ignores turn limit in close_orders even if max is set", () => {
        const p = parseAiOrderModePolicy({
            ai_order_mode: "close_orders",
            ai_max_turns_per_session: 3,
        });
        assert.equal(hasAiTurnLimit(p), false);
        assert.equal(isAiTurnLimitExceeded({ aiTurnCount: 99 }, p, Date.now()), false);
    });

    it("resets window after wall-clock expiry", () => {
        const p = parseAiOrderModePolicy({
            ai_order_mode: "info_only",
            ai_session_window_minutes: 60,
            ai_max_turns_per_session: 2,
        });
        const started = new Date(Date.now() - 61 * 60_000).toISOString();
        const w = resolveAiTurnWindow(
            { aiTurnCount: 2, aiWindowStartedAt: started },
            p,
            Date.now()
        );
        assert.equal(w.reset, true);
        assert.equal(w.count, 0);
        assert.equal(
            isAiTurnLimitExceeded({ aiTurnCount: 2, aiWindowStartedAt: started }, p, Date.now()),
            false
        );
    });

    it("exceeds when count >= max inside window", () => {
        const p = parseAiOrderModePolicy({
            ai_order_mode: "info_only",
            ai_session_window_minutes: 60,
            ai_max_turns_per_session: 2,
        });
        const started = new Date().toISOString();
        assert.equal(
            isAiTurnLimitExceeded({ aiTurnCount: 2, aiWindowStartedAt: started }, p, Date.now()),
            true
        );
        const bumped = bumpAiTurnCount(
            { aiTurnCount: 1, aiWindowStartedAt: started },
            p,
            Date.now()
        );
        assert.equal(bumped.aiTurnCount, 2);
    });
});
