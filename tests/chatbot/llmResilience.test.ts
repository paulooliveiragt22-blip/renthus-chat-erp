import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
    isLlmRateLimitError,
    resetCircuitForTests,
    runLlmWithResilience,
    getCircuitOpenRemainingMs,
    type CircuitStateChangeEvent,
} from "../../lib/chatbot/llmResilience";
import type { LlmProviderName } from "../../src/pro/adapters/ai/modelProvider";

const PROVIDERS: LlmProviderName[] = ["anthropic", "openai", "ollama", "groq"];

describe("llmResilience", () => {
    beforeEach(() => {
        resetCircuitForTests();
        delete process.env.ANTHROPIC_CIRCUIT_OPEN_MS;
        delete process.env.OPENAI_CIRCUIT_OPEN_MS;
        process.env.ANTHROPIC_CHATBOT_MAX_IN_FLIGHT = "8";
        process.env.OPENAI_CHATBOT_MAX_IN_FLIGHT = "8";
    });

    it("detecta rate limit por status e mensagem (genérico, os dois providers)", () => {
        assert.equal(isLlmRateLimitError({ status: 429 }), true);
        assert.equal(isLlmRateLimitError({ message: "Rate limit exceeded" }), true);
        assert.equal(isLlmRateLimitError({ error: { type: "rate_limit_error" } }), true);
        assert.equal(isLlmRateLimitError({ status: 500 }), false);
    });

    for (const provider of PROVIDERS) {
        it(`[${provider}] retenta em 429 e sucede`, async () => {
            let calls = 0;
            const result = await runLlmWithResilience(
                provider,
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
            assert.equal(getCircuitOpenRemainingMs(provider), 0);
        });

        it(`[${provider}] abre circuit após 3× 429`, async () => {
            const envName = provider === "anthropic" ? "ANTHROPIC_CIRCUIT_OPEN_MS" : "OPENAI_CIRCUIT_OPEN_MS";
            process.env[envName] = "60000";
            let calls = 0;
            await assert.rejects(
                () =>
                    runLlmWithResilience(
                        provider,
                        async () => {
                            calls += 1;
                            const err = new Error("429");
                            (err as { status?: number }).status = 429;
                            throw err;
                        },
                        { maxRetries: 2 }
                    ),
                (e: Error) => /429|rate|circuit/i.test(e.message)
            );
            assert.ok(calls >= 3);
            assert.ok(getCircuitOpenRemainingMs(provider) > 0);

            await assert.rejects(
                () => runLlmWithResilience(provider, async () => "never"),
                (e: Error) => e.message === `${provider}_circuit_open`
            );
        });
    }

    it("isolamento: circuito da Anthropic aberto não afeta chamada OpenAI concorrente (regressão que motivou a Fase 7)", async () => {
        process.env.ANTHROPIC_CIRCUIT_OPEN_MS = "60000";

        // Abre o circuito só da Anthropic.
        await assert.rejects(() =>
            runLlmWithResilience(
                "anthropic",
                async () => {
                    const err = new Error("429");
                    (err as { status?: number }).status = 429;
                    throw err;
                },
                { maxRetries: 2 }
            )
        );
        assert.ok(getCircuitOpenRemainingMs("anthropic") > 0);
        assert.equal(getCircuitOpenRemainingMs("openai"), 0);

        // Anthropic: circuito aberto, rejeita na hora sem nem chamar fn.
        let anthropicFnCalled = false;
        await assert.rejects(
            () =>
                runLlmWithResilience("anthropic", async () => {
                    anthropicFnCalled = true;
                    return "never";
                }),
            (e: Error) => e.message === "anthropic_circuit_open"
        );
        assert.equal(anthropicFnCalled, false);

        // OpenAI: circuito próprio continua fechado, chamada roda normalmente.
        const openaiResult = await runLlmWithResilience("openai", async () => "ok-openai");
        assert.equal(openaiResult, "ok-openai");
    });

    it("emite onCircuitStateChange('open') quando o circuito abre (Fase 9)", async () => {
        process.env.OPENAI_CIRCUIT_OPEN_MS = "60000";
        const events: CircuitStateChangeEvent[] = [];
        await assert.rejects(() =>
            runLlmWithResilience(
                "openai",
                async () => {
                    const err = new Error("429");
                    (err as { status?: number }).status = 429;
                    throw err;
                },
                { maxRetries: 2, onCircuitStateChange: (e) => events.push(e) }
            )
        );
        assert.equal(events.length, 1);
        assert.deepEqual(events[0], { provider: "openai", state: "open", openMs: 60000 });
    });

    it("emite onCircuitStateChange('close') na primeira chamada bem-sucedida após o circuito ter aberto (Fase 9)", async () => {
        process.env.ANTHROPIC_CIRCUIT_OPEN_MS = "1";
        const events: CircuitStateChangeEvent[] = [];
        await assert.rejects(() =>
            runLlmWithResilience(
                "anthropic",
                async () => {
                    const err = new Error("429");
                    (err as { status?: number }).status = 429;
                    throw err;
                },
                { maxRetries: 2, onCircuitStateChange: (e) => events.push(e) }
            )
        );
        assert.equal(events.length, 1);
        assert.equal(events[0].state, "open");

        // Janela de abertura (1ms) já expirou — próxima chamada roda e, ao suceder, fecha o circuito.
        await new Promise((r) => setTimeout(r, 5));
        const result = await runLlmWithResilience("anthropic", async () => "ok", {
            onCircuitStateChange: (e) => events.push(e),
        });
        assert.equal(result, "ok");
        assert.equal(events.length, 2);
        assert.deepEqual(events[1], { provider: "anthropic", state: "close" });
    });
});
