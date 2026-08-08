import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasLlmApiKey } from "../../src/pro/adapters/llm/llmText";

describe("hasLlmApiKey", () => {
    it("respeita provider configurado", () => {
        const prevP = process.env.LLM_PROVIDER;
        const prevA = process.env.ANTHROPIC_API_KEY;
        const prevO = process.env.OPENAI_API_KEY;
        try {
            process.env.LLM_PROVIDER = "openai";
            delete process.env.OPENAI_API_KEY;
            assert.equal(hasLlmApiKey(), false);
            process.env.OPENAI_API_KEY = "sk-test";
            assert.equal(hasLlmApiKey(), true);
        } finally {
            if (prevP === undefined) delete process.env.LLM_PROVIDER;
            else process.env.LLM_PROVIDER = prevP;
            if (prevA === undefined) delete process.env.ANTHROPIC_API_KEY;
            else process.env.ANTHROPIC_API_KEY = prevA;
            if (prevO === undefined) delete process.env.OPENAI_API_KEY;
            else process.env.OPENAI_API_KEY = prevO;
        }
    });

    it("default anthropic quando provider não definido", () => {
        const prevP = process.env.LLM_PROVIDER;
        const prevA = process.env.ANTHROPIC_API_KEY;
        try {
            delete process.env.LLM_PROVIDER;
            delete process.env.ANTHROPIC_API_KEY;
            assert.equal(hasLlmApiKey(), false);
            process.env.ANTHROPIC_API_KEY = "sk-ant-test";
            assert.equal(hasLlmApiKey(), true);
        } finally {
            if (prevP === undefined) delete process.env.LLM_PROVIDER;
            else process.env.LLM_PROVIDER = prevP;
            if (prevA === undefined) delete process.env.ANTHROPIC_API_KEY;
            else process.env.ANTHROPIC_API_KEY = prevA;
        }
    });
});
