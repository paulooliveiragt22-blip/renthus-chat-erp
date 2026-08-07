import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LlmPort } from "../../src/pro/ports/llm.port";
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
        const llm: LlmPort = {
            chat: async () => ({
                content: [{ type: "text", text: "Cliente pediu água e pizza; falta endereço." }],
                stopReason: "end_turn",
                provider: "test",
                model: "test",
            }),
        };
        const mem = new LlmSessionMemoryAdapter(llm);
        const history = turns(SESSION_MEMORY_TRIGGER_MIN + 4);
        const out = await mem.compactIfNeeded({ history });
        assert.equal(out.compacted, true);
        assert.equal(out.history.length, SESSION_MEMORY_KEEP_RECENT);
        assert.match(String(out.summary), /água|pizza|endereço/i);
    });

    it("LlmSessionMemory não compacta abaixo do trigger", async () => {
        const llm: LlmPort = {
            chat: async () => {
                throw new Error("não deve chamar");
            },
        };
        const mem = new LlmSessionMemoryAdapter(llm);
        const history = turns(4);
        const out = await mem.compactIfNeeded({ history });
        assert.equal(out.compacted, false);
        assert.equal(out.history.length, 4);
    });
});
