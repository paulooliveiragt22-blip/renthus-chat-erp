import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareOutbound } from "@/src/pro/replay/compareOutbound";
import {
    ReplayLlmPort,
    fingerprintLlmRequest,
} from "@/src/pro/adapters/llm/recording.llm";
import type { LlmChatRequest } from "@/src/pro/ports/llm.port";

describe("replay harness helpers", () => {
    it("compareOutbound marca igualdade e mismatch", () => {
        const ok = compareOutbound(
            [{ kind: "text", text: "Oi" }],
            [{ kind: "text", text: "  oi " }]
        );
        assert.equal(ok.equal, true);

        const bad = compareOutbound(
            [{ kind: "text", text: "Oi" }],
            [{ kind: "text", text: "Tchau" }]
        );
        assert.equal(bad.equal, false);
        assert.equal(bad.mismatches.length, 1);
    });

    it("ReplayLlmPort devolve cassete por ordem e depois vazio", async () => {
        const port = new ReplayLlmPort([
            {
                requestFingerprint: "a",
                response: {
                    content: [{ type: "text", text: "r1" }],
                    stopReason: "end_turn",
                    provider: "replay",
                    model: "c",
                },
            },
        ]);
        const r1 = await port.chat({} as LlmChatRequest);
        assert.deepEqual(r1.content, [{ type: "text", text: "r1" }]);
        const r2 = await port.chat({} as LlmChatRequest);
        assert.equal(r2.model, "cassette-exhausted");
    });

    it("fingerprintLlmRequest usa último user", () => {
        const fp = fingerprintLlmRequest({
            system: "s",
            messages: [
                { role: "user", content: "um" },
                { role: "assistant", content: "x" },
                { role: "user", content: "dois" },
            ],
            maxTokens: 10,
            timeoutMs: 1000,
            purpose: "test",
        });
        assert.match(fp, /dois/);
    });
});
