import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasLlmApiKey } from "../../src/pro/adapters/llm/llmText";

function withEnv(patch: Record<string, string | undefined>, fn: () => void): void {
    const prev: Record<string, string | undefined> = {};
    for (const k of Object.keys(patch)) {
        prev[k] = process.env[k];
        const v = patch[k];
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    try {
        fn();
    } finally {
        for (const k of Object.keys(patch)) {
            const v = prev[k];
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}

describe("hasLlmApiKey", () => {
    it("respeita provider openai via env", () => {
        withEnv(
            { LLM_PROVIDER: "openai", OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: "sk-ant" },
            () => {
                assert.equal(hasLlmApiKey(), false);
                process.env.OPENAI_API_KEY = "sk-test";
                assert.equal(hasLlmApiKey(), true);
            }
        );
    });

    it("default anthropic quando provider não definido", () => {
        withEnv({ LLM_PROVIDER: undefined, ANTHROPIC_API_KEY: undefined }, () => {
            assert.equal(hasLlmApiKey(), false);
            process.env.ANTHROPIC_API_KEY = "sk-ant-test";
            assert.equal(hasLlmApiKey(), true);
        });
    });

    it("groq exige GROQ_API_KEY (não cai em Anthropic)", () => {
        withEnv(
            {
                LLM_PROVIDER: "anthropic",
                ANTHROPIC_API_KEY: "sk-ant-present",
                GROQ_API_KEY: undefined,
            },
            () => {
                assert.equal(hasLlmApiKey("groq"), false);
                process.env.GROQ_API_KEY = "gsk-test";
                assert.equal(hasLlmApiKey("groq"), true);
                // Sem override: env LLM_PROVIDER=anthropic ainda usa ANTHROPIC_API_KEY
                assert.equal(hasLlmApiKey(), true);
            }
        );
    });

    it("ollama sempre true; provider desconhecido = false", () => {
        withEnv({ ANTHROPIC_API_KEY: "sk-ant", GROQ_API_KEY: "gsk", OPENAI_API_KEY: "sk" }, () => {
            assert.equal(hasLlmApiKey("ollama"), true);
            assert.equal(hasLlmApiKey("gemini"), false);
        });
    });
});
