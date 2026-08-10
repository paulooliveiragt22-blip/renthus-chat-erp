import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { configuredProvider, configuredModel } from "../../lib/chatbot/aiCapabilityProfile";
import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from "../../src/pro/adapters/ai/modelProvider";

describe("aiCapabilityProfile — provider/model por empresa (Fase 3 do plano multi-provider)", () => {
    const prevProvider = process.env.LLM_PROVIDER;
    const prevModel = process.env.LLM_MODEL;

    afterEach(() => {
        const restore = (name: string, value: string | undefined) => {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        };
        restore("LLM_PROVIDER", prevProvider);
        restore("LLM_MODEL", prevModel);
    });

    it("sem companyOverride, usa o env global (comportamento atual)", () => {
        delete process.env.LLM_PROVIDER;
        assert.equal(configuredProvider(undefined), "anthropic");
        assert.equal(configuredProvider(null), "anthropic");

        process.env.LLM_PROVIDER = "openai";
        assert.equal(configuredProvider(undefined), "openai");
    });

    it("companyOverride válido tem prioridade sobre o env", () => {
        process.env.LLM_PROVIDER = "anthropic";
        assert.equal(configuredProvider("openai"), "openai");

        process.env.LLM_PROVIDER = "openai";
        assert.equal(configuredProvider("anthropic"), "anthropic");
    });

    it("companyOverride inválido (defesa) cai no env, não quebra", () => {
        process.env.LLM_PROVIDER = "anthropic";
        assert.equal(configuredProvider("acme"), "anthropic");
        assert.equal(configuredProvider(""), "anthropic");
    });

    it("configuredModel usa DEFAULT_* de modelProvider.ts (sem duplicar literal)", () => {
        delete process.env.LLM_MODEL;
        assert.equal(configuredModel("anthropic"), DEFAULT_ANTHROPIC_MODEL);
        assert.equal(configuredModel("openai"), DEFAULT_OPENAI_MODEL);
    });

    it("LLM_MODEL no env sobrepõe o default de qualquer provider", () => {
        process.env.LLM_MODEL = "modelo-customizado";
        assert.equal(configuredModel("anthropic"), "modelo-customizado");
        assert.equal(configuredModel("openai"), "modelo-customizado");
    });
});
