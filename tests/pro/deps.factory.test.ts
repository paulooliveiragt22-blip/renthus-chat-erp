import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProcessMessageParams } from "../../lib/chatbot/types";
import { applyCircuitStateChangeToMetrics, makeProPipelineDependencies } from "../../src/pro/pipeline/deps.factory";
import type { SessionRepository } from "../../src/pro/ports/session.repository";
import type { MetricsPort } from "../../src/pro/ports/metrics.port";

function minimalParams(): ProcessMessageParams {
    return {
        admin: {} as ProcessMessageParams["admin"],
        companyId: "c1",
        threadId: "t1",
        messageId: "m1",
        phoneE164: "+5511999999999",
        text: "oi",
    };
}

describe("makeProPipelineDependencies (R2 overrides)", () => {
    it("substitui portas via overrides sem perder as restantes", () => {
        const customRepo: SessionRepository = {
            load: async () => null,
            save: async () => undefined,
        };
        const deps = makeProPipelineDependencies(minimalParams(), {
            overrides: { sessionRepo: customRepo },
        });
        assert.strictEqual(deps.sessionRepo, customRepo);
        assert.equal(typeof deps.aiService.run, "function");
        assert.equal(typeof deps.orderService.createFromDraft, "function");
    });
});

describe("applyCircuitStateChangeToMetrics (Fase 9 — provider tag no circuit breaker)", () => {
    it("emite pro_pipeline.llm_circuit_open com tags provider/companyId", () => {
        const calls: Array<{ name: string; value?: number; tags?: Record<string, string> }> = [];
        const metrics: MetricsPort = {
            increment: (name, value, tags) => calls.push({ name, value, tags }),
            timing: () => undefined,
        };
        applyCircuitStateChangeToMetrics(metrics, { provider: "openai", state: "open", openMs: 30000 }, "c1");
        assert.deepEqual(calls, [
            { name: "pro_pipeline.llm_circuit_open", value: 1, tags: { provider: "openai", companyId: "c1" } },
        ]);
    });

    it("emite pro_pipeline.llm_circuit_close", () => {
        const calls: Array<{ name: string; tags?: Record<string, string> }> = [];
        const metrics: MetricsPort = {
            increment: (name, _value, tags) => calls.push({ name, tags }),
            timing: () => undefined,
        };
        applyCircuitStateChangeToMetrics(metrics, { provider: "anthropic", state: "close" }, "c2");
        assert.deepEqual(calls, [
            { name: "pro_pipeline.llm_circuit_close", tags: { provider: "anthropic", companyId: "c2" } },
        ]);
    });
});
