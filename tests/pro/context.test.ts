import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { policiesFromAiCapability } from "../../src/pro/pipeline/context";

describe("policiesFromAiCapability — propagação de provider/model (Fase 4 do plano multi-provider)", () => {
    it("perfil avançado com llmEnabled: propaga aiProvider/aiModel", () => {
        const policies = policiesFromAiCapability({
            tier: "avancado",
            maxToolRounds: 12,
            maxHistoryTurns: 24,
            aiTimeoutMs: 15_000,
            llmEnabled: true,
            model: "gpt-5-mini",
            provider: "openai",
            planKey: "pro",
        });
        assert.equal(policies.aiProvider, "openai");
        assert.equal(policies.aiModel, "gpt-5-mini");
        assert.equal(policies.llmEnabled, true);
    });

    it("perfil degradado: ainda propaga provider/model (mesmo com llmEnabled=false)", () => {
        const policies = policiesFromAiCapability({
            tier: "degradado",
            maxToolRounds: 0,
            maxHistoryTurns: 0,
            aiTimeoutMs: 15_000,
            llmEnabled: false,
            model: "claude-haiku-4-5-20251001",
            provider: "anthropic",
            planKey: null,
        });
        assert.equal(policies.aiProvider, "anthropic");
        assert.equal(policies.aiModel, "claude-haiku-4-5-20251001");
        assert.equal(policies.llmEnabled, false);
    });

    it("sem capability (undefined): não quebra, aiProvider/aiModel ficam undefined", () => {
        const policies = policiesFromAiCapability(undefined);
        assert.equal(policies.aiProvider, undefined);
        assert.equal(policies.aiModel, undefined);
        assert.equal(policies.llmEnabled, false);
    });

    it("capability sem provider (retrocompat — replay/testes que não setam esse campo)", () => {
        const policies = policiesFromAiCapability({
            tier: "avancado",
            maxToolRounds: 8,
            maxHistoryTurns: 12,
            aiTimeoutMs: 5_000,
            llmEnabled: true,
            model: "replay",
            planKey: "market",
        });
        assert.equal(policies.aiProvider, undefined);
        assert.equal(policies.aiModel, "replay");
    });
});
