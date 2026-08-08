import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import {
    extractiveHistorySummary,
    LlmSessionMemoryAdapter,
    NoopSessionMemoryAdapter,
    SESSION_MEMORY_KEEP_RECENT,
    SESSION_MEMORY_TRIGGER_MIN,
} from "../../src/pro/adapters/ai/sessionMemory.llm";
import type { AiTurn } from "../../src/types/contracts";

function turns(n: number): AiTurn[] {
    return Array.from({ length: n }, (_, i) => ({
        role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
        content: `msg-${i}`,
        ts: i,
    }));
}

function mockModelWithText(text: string): MockLanguageModelV3 {
    return new MockLanguageModelV3({
        doGenerate: async () => ({
            content: [{ type: "text", text }],
            finishReason: { unified: "stop", raw: undefined },
            usage: {
                inputTokens: { total: 30, noCache: 30, cacheRead: undefined, cacheWrite: undefined },
                outputTokens: { total: 15, text: 15, reasoning: undefined },
            },
            warnings: [],
        }),
    });
}

function mockModelThatMustNotBeCalled(): MockLanguageModelV3 {
    return new MockLanguageModelV3({
        doGenerate: async () => {
            throw new Error("não deve chamar o modelo abaixo do trigger");
        },
    });
}

describe("SessionMemoryPort adapters", () => {
    it("Noop nunca compacta", async () => {
        const mem = new NoopSessionMemoryAdapter();
        const history = turns(30);
        const out = await mem.compactIfNeeded({ history, existingSummary: "x" });
        assert.equal(out.compacted, false);
        assert.equal(out.history.length, 30);
        assert.equal(out.summary, "x");
    });

    it("extractiveHistorySummary concatena trechos", () => {
        const s = extractiveHistorySummary(turns(2), "pré");
        assert.match(s, /pré/);
        assert.match(s, /Cliente:/);
        assert.match(s, /Assistente:/);
    });

    it("LlmSessionMemory compacta acima do trigger e usa LLM", async () => {
        const model = mockModelWithText("Cliente pediu água e pizza; falta endereço.");
        const mem = new LlmSessionMemoryAdapter(undefined, undefined, model);
        const history = turns(SESSION_MEMORY_TRIGGER_MIN + 4);
        const out = await mem.compactIfNeeded({ history });
        assert.equal(out.compacted, true);
        assert.equal(out.history.length, SESSION_MEMORY_KEEP_RECENT);
        assert.match(String(out.summary), /água|pizza|endereço/i);
    });

    it("LlmSessionMemory não compacta abaixo do trigger (nem chama o modelo)", async () => {
        const model = mockModelThatMustNotBeCalled();
        const mem = new LlmSessionMemoryAdapter(undefined, undefined, model);
        const history = turns(4);
        const out = await mem.compactIfNeeded({ history });
        assert.equal(out.compacted, false);
        assert.equal(out.history.length, 4);
    });

    it("LlmSessionMemory cai no resumo extrativo se o modelo falhar", async () => {
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                throw new Error("simulated provider error");
            },
        });
        const mem = new LlmSessionMemoryAdapter(undefined, undefined, model);
        const history = turns(SESSION_MEMORY_TRIGGER_MIN + 4);
        const out = await mem.compactIfNeeded({ history });
        assert.equal(out.compacted, true);
        assert.equal(out.history.length, SESSION_MEMORY_KEEP_RECENT);
        assert.match(String(out.summary), /Cliente:|Assistente:/);
    });
});
