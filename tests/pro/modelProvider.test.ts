import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import {
    getConfiguredLlmProviderName,
    resolveLanguageModel,
    LlmProviderConfigError,
} from "../../src/pro/adapters/ai/modelProvider";

describe("modelProvider", () => {
    const prevProvider = process.env.LLM_PROVIDER;
    const prevModel = process.env.LLM_MODEL;
    const prevAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const prevOpenAiKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
        const restore = (name: string, value: string | undefined) => {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        };
        restore("LLM_PROVIDER", prevProvider);
        restore("LLM_MODEL", prevModel);
        restore("ANTHROPIC_API_KEY", prevAnthropicKey);
        restore("OPENAI_API_KEY", prevOpenAiKey);
    });

    it("default é anthropic", () => {
        delete process.env.LLM_PROVIDER;
        assert.equal(getConfiguredLlmProviderName(), "anthropic");
    });

    it("LLM_PROVIDER=openai é reconhecido", () => {
        process.env.LLM_PROVIDER = "openai";
        assert.equal(getConfiguredLlmProviderName(), "openai");
    });

    it("provider desconhecido → LlmProviderConfigError", () => {
        process.env.LLM_PROVIDER = "acme";
        assert.throws(
            () => getConfiguredLlmProviderName(),
            (e: unknown) => e instanceof LlmProviderConfigError
        );
    });

    it("resolveLanguageModel sem ANTHROPIC_API_KEY → erro tipado (não tenta chamar rede)", () => {
        process.env.LLM_PROVIDER = "anthropic";
        delete process.env.ANTHROPIC_API_KEY;
        assert.throws(
            () => resolveLanguageModel(),
            (e: unknown) => e instanceof LlmProviderConfigError
        );
    });

    it("resolveLanguageModel sem OPENAI_API_KEY → erro tipado (não tenta chamar rede)", () => {
        process.env.LLM_PROVIDER = "openai";
        delete process.env.OPENAI_API_KEY;
        assert.throws(
            () => resolveLanguageModel(),
            (e: unknown) => e instanceof LlmProviderConfigError
        );
    });

    it("resolveLanguageModel com chave presente devolve um LanguageModel (não lança)", () => {
        process.env.LLM_PROVIDER = "anthropic";
        process.env.ANTHROPIC_API_KEY = "sk-ant-test-fake-key";
        const model = resolveLanguageModel();
        assert.ok(model);
    });

    it("modelOverride tem prioridade sobre LLM_MODEL/default", () => {
        process.env.LLM_PROVIDER = "anthropic";
        process.env.ANTHROPIC_API_KEY = "sk-ant-test-fake-key";
        process.env.LLM_MODEL = "claude-not-used";
        const model = resolveLanguageModel("claude-override-model");
        assert.ok(model);
    });
});
