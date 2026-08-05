import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anthropicStyleMessagesToOpenAi } from "../../src/pro/adapters/llm/openai.llm";
import { extractLlmPlainText, hasLlmApiKey } from "../../src/pro/adapters/llm/llmText";

describe("openai message convert + llmText", () => {
    it("string messages passam diretos", () => {
        const out = anthropicStyleMessagesToOpenAi([
            { role: "user", content: "oi" },
            { role: "assistant", content: "olá" },
        ]);
        assert.deepEqual(out, [
            { role: "user", content: "oi" },
            { role: "assistant", content: "olá" },
        ]);
    });

    it("tool_use + tool_result → tool_calls + role=tool", () => {
        const out = anthropicStyleMessagesToOpenAi([
            {
                role: "assistant",
                content: [
                    { type: "text", text: "buscando" },
                    {
                        type: "tool_use",
                        id: "tu1",
                        name: "search_produtos",
                        input: { query: "brahma" },
                    },
                ],
            },
            {
                role: "user",
                content: [
                    {
                        type: "tool_result",
                        tool_use_id: "tu1",
                        content: '{"items":[]}',
                    },
                ],
            },
        ]);
        assert.equal(out[0]?.role, "assistant");
        assert.ok(
            out[0] &&
                "tool_calls" in out[0] &&
                Array.isArray(out[0].tool_calls) &&
                out[0].tool_calls?.[0]?.id === "tu1"
        );
        assert.equal(out[1]?.role, "tool");
        if (out[1]?.role === "tool") {
            assert.equal(out[1].tool_call_id, "tu1");
        }
    });

    it("extractLlmPlainText lê blocos text", () => {
        assert.equal(
            extractLlmPlainText([{ type: "text", text: "order_intent" }]),
            "order_intent"
        );
    });

    it("hasLlmApiKey respeita provider", () => {
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
});
