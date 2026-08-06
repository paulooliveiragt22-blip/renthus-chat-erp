import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { policiesFromAiCapability } from "@/src/pro/pipeline/context";

describe("policiesFromAiCapability", () => {
    it("degradado / llm off → maxToolRounds 0 e llmEnabled false", () => {
        const p = policiesFromAiCapability({
            tier: "degradado",
            maxToolRounds: 0,
            maxHistoryTurns: 0,
            aiTimeoutMs: 15_000,
            llmEnabled: false,
            model: "claude-haiku-4-5",
        });
        assert.equal(p.llmEnabled, false);
        assert.equal(p.maxToolRounds, 0);
        assert.equal(p.maxHistoryTurns, 0);
    });

    it("basico → orçamento reduzido", () => {
        const p = policiesFromAiCapability({
            tier: "basico",
            maxToolRounds: 4,
            maxHistoryTurns: 8,
            aiTimeoutMs: 15_000,
            llmEnabled: true,
            model: "claude-haiku-4-5",
            planKey: "essencial",
        });
        assert.equal(p.llmEnabled, true);
        assert.equal(p.maxToolRounds, 4);
        assert.equal(p.maxHistoryTurns, 8);
    });

    it("avancado → orçamento cheio", () => {
        const p = policiesFromAiCapability({
            tier: "avancado",
            maxToolRounds: 12,
            maxHistoryTurns: 24,
            aiTimeoutMs: 15_000,
            llmEnabled: true,
            model: "claude-haiku-4-5",
            planKey: "pro",
        });
        assert.equal(p.maxToolRounds, 12);
        assert.equal(p.maxHistoryTurns, 24);
    });
});
