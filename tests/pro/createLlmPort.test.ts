import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { createLlmPort, getConfiguredLlmProvider } from "../../src/pro/adapters/llm/createLlmPort";
import { AnthropicLlmAdapter } from "../../src/pro/adapters/llm/anthropic.llm";
import { OpenAiLlmAdapter } from "../../src/pro/adapters/llm/openai.llm";
import { LlmProviderError } from "../../src/pro/ports/llm.port";

describe("createLlmPort", () => {
    const prevProvider = process.env.LLM_PROVIDER;
    const prevModel = process.env.LLM_MODEL;

    afterEach(() => {
        if (prevProvider === undefined) delete process.env.LLM_PROVIDER;
        else process.env.LLM_PROVIDER = prevProvider;
        if (prevModel === undefined) delete process.env.LLM_MODEL;
        else process.env.LLM_MODEL = prevModel;
    });

    it("default anthropic", () => {
        delete process.env.LLM_PROVIDER;
        assert.equal(getConfiguredLlmProvider(), "anthropic");
        assert.ok(createLlmPort() instanceof AnthropicLlmAdapter);
    });

    it("openai → OpenAiLlmAdapter", () => {
        process.env.LLM_PROVIDER = "openai";
        assert.ok(createLlmPort() instanceof OpenAiLlmAdapter);
    });

    it("provider desconhecido → erro tipado", () => {
        process.env.LLM_PROVIDER = "acme";
        assert.throws(
            () => createLlmPort(),
            (e: unknown) =>
                e instanceof LlmProviderError ||
                (e instanceof Error && e.name === "LlmProviderError")
        );
    });
});
