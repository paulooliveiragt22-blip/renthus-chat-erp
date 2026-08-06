import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { beginAwaitingPhone } from "@/src/pro/pipeline/handleAwaitingPhone";
import type { ProSessionState } from "@/src/types/contracts";

function baseState(overrides: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_awaiting_confirmation",
        customerId: "11111111-1111-1111-1111-111111111111",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...overrides,
    };
}

describe("beginAwaitingPhone", () => {
    it("marca needsPhone e muda step", () => {
        const next = beginAwaitingPhone(baseState());
        assert.equal(next.step, "pro_awaiting_phone");
        assert.equal(next.needsPhone, true);
        assert.equal(next.resumeStepAfterPhone, "pro_awaiting_confirmation");
    });
});
