import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { estimateLlmCostBrlCents, resolveLlmRates } from "@/lib/billing/llmPricing";

describe("llmPricing", () => {
    it("resolve Haiku e gpt-4o-mini", () => {
        const h = resolveLlmRates("claude-haiku-4-5-20251001");
        assert.equal(h.matched, true);
        assert.equal(h.inputUsdPerM, 1);
        assert.equal(h.outputUsdPerM, 5);

        const m = resolveLlmRates("gpt-4o-mini");
        assert.equal(m.matched, true);
        assert.equal(m.inputUsdPerM, 0.15);
        assert.equal(m.outputUsdPerM, 0.6);
    });

    it("fallback caro para modelo desconhecido", () => {
        const u = resolveLlmRates("modelo-futuro-xyz");
        assert.equal(u.matched, false);
        assert.equal(u.inputUsdPerM, 3);
        assert.equal(u.outputUsdPerM, 15);
    });

    it("estima centavos BRL com câmbio 5.5", () => {
        // 1M in + 0 out Haiku: $1 × 5.5 × 100 = 550 centavos
        assert.equal(estimateLlmCostBrlCents("claude-haiku-4-5", 1_000_000, 0, 5.5), 550);
        // 1M in gpt-4o-mini: $0.15 × 5.5 × 100 = 82.5 → 83
        assert.equal(estimateLlmCostBrlCents("gpt-4o-mini", 1_000_000, 0, 5.5), 83);
        // uso mínimo ainda cobra 1 centavo
        assert.equal(estimateLlmCostBrlCents("claude-haiku-4-5", 10, 10, 5.5), 1);
    });
});
