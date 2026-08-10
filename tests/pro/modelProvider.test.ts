import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import {
    getConfiguredLlmProviderName,
    resolveLanguageModel,
    LlmProviderConfigError,
    DEFAULT_ANTHROPIC_MODEL,
    DEFAULT_OPENAI_MODEL,
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

    it("defaults corretos: Haiku 4.5 (Anthropic) e GPT-5 mini (OpenAI, não gpt-4o-mini)", () => {
        assert.equal(DEFAULT_ANTHROPIC_MODEL, "claude-haiku-4-5-20251001");
        assert.equal(DEFAULT_OPENAI_MODEL, "gpt-5-mini");
    });

    it("override de provider explícito (objeto) ignora LLM_PROVIDER do env", () => {
        process.env.LLM_PROVIDER = "anthropic";
        process.env.OPENAI_API_KEY = "sk-test-fake-key";
        delete process.env.ANTHROPIC_API_KEY;
        // env diz anthropic (sem key) — override explícito pra openai deve funcionar mesmo assim.
        const model = resolveLanguageModel({ provider: "openai" });
        assert.ok(model);
    });

    it("sem override (objeto vazio ou undefined) usa o provider do env, como antes", () => {
        process.env.LLM_PROVIDER = "openai";
        process.env.OPENAI_API_KEY = "sk-test-fake-key";
        delete process.env.ANTHROPIC_API_KEY;
        const model = resolveLanguageModel({});
        assert.ok(model);
    });

    it("objeto com provider + model explícitos ignora env dos dois", () => {
        process.env.LLM_PROVIDER = "anthropic";
        process.env.LLM_MODEL = "claude-not-used";
        process.env.OPENAI_API_KEY = "sk-test-fake-key";
        const model = resolveLanguageModel({ provider: "openai", model: "gpt-5-mini-custom" });
        assert.ok(model);
    });
});
