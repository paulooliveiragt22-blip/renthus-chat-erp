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

    it("resolve gpt-5-mini (exato, snapshot e includes)", () => {
        const exact = resolveLlmRates("gpt-5-mini");
        assert.equal(exact.matched, true);
        assert.equal(exact.inputUsdPerM, 0.25);
        assert.equal(exact.outputUsdPerM, 2);

        const snapshot = resolveLlmRates("gpt-5-mini-2025-08-07");
        assert.equal(snapshot.matched, true);
        assert.equal(snapshot.inputUsdPerM, 0.25);
        assert.equal(snapshot.outputUsdPerM, 2);

        // variação não catalogada, mas contém "gpt-5-mini" — não pode cair no fallback caro
        const heuristic = resolveLlmRates("gpt-5-mini-preview");
        assert.equal(heuristic.matched, true);
        assert.equal(heuristic.inputUsdPerM, 0.25);
        assert.equal(heuristic.outputUsdPerM, 2);
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
