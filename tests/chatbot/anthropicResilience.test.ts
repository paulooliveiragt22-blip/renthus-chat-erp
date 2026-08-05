import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
    isAnthropicRateLimitError,
    resetAnthropicCircuitForTests,
    runAnthropicWithResilience,
    getAnthropicCircuitOpenRemainingMs,
} from "../../lib/chatbot/anthropicResilience";

describe("anthropicResilience", () => {
    beforeEach(() => {
        resetAnthropicCircuitForTests();
        delete process.env.ANTHROPIC_CIRCUIT_OPEN_MS;
        process.env.ANTHROPIC_CHATBOT_MAX_IN_FLIGHT = "8";
    });

    it("detecta 429 por status e mensagem", () => {
        assert.equal(isAnthropicRateLimitError({ status: 429 }), true);
        assert.equal(isAnthropicRateLimitError({ message: "Rate limit exceeded" }), true);
        assert.equal(isAnthropicRateLimitError({ error: { type: "rate_limit_error" } }), true);
        assert.equal(isAnthropicRateLimitError({ status: 500 }), false);
    });

    it("retenta em 429 e sucede", async () => {
        let calls = 0;
        const result = await runAnthropicWithResilience(
            async () => {
                calls += 1;
                if (calls < 3) {
                    const err = new Error("rate limit");
                    (err as { status?: number }).status = 429;
                    throw err;
                }
                return "ok";
            },
            { maxRetries: 3 }
        );
        assert.equal(result, "ok");
        assert.equal(calls, 3);
        assert.equal(getAnthropicCircuitOpenRemainingMs(), 0);
    });

    it("abre circuit após 3× 429", async () => {
        process.env.ANTHROPIC_CIRCUIT_OPEN_MS = "60000";
        let calls = 0;
        await assert.rejects(
            () =>
                runAnthropicWithResilience(
                    async () => {
                        calls += 1;
                        const err = new Error("429");
                        (err as { status?: number }).status = 429;
                        throw err;
                    },
                    { maxRetries: 2 }
                ),
            (e: Error) => /429|rate/i.test(e.message)
        );
        assert.ok(calls >= 3);
        assert.ok(getAnthropicCircuitOpenRemainingMs() > 0);

        await assert.rejects(
            () => runAnthropicWithResilience(async () => "never"),
            (e: Error) => e.message === "anthropic_circuit_open"
        );
    });
});
