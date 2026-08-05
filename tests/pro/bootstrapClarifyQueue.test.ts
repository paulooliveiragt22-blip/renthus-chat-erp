import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    dequeueBootstrapClarification,
    hasPendingBootstrapClarifications,
} from "../../src/pro/pipeline/bootstrapClarifyQueue";
import type { ProSessionState } from "../../src/types/contracts";

function baseState(over: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_collecting_order",
        customerId: null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        bootstrapResolvedEmbalagemIds: ["heineken-id"],
        bootstrapPendingClarifications: [
            {
                segment: "salgadinho",
                picks: [
                    { embalagemId: "salg-un", label: "SALGADINHO", price: 15 },
                    { embalagemId: "salg-cx", label: "SALGADINHO CX", price: 220 },
                ],
            },
        ],
        ...over,
    };
}

describe("bootstrapClarifyQueue", () => {
    it("dequeue salgadinho após Heineken", () => {
        const { state, outbound } = dequeueBootstrapClarification(baseState());
        assert.equal(hasPendingBootstrapClarifications(state), false);
        assert.equal(outbound.length, 1);
        assert.equal(outbound[0]?.kind, "buttons");
        assert.deepEqual(
            state.lastSearchPicks?.map((p) => p.embalagemId),
            ["salg-un", "salg-cx"]
        );
        assert.ok(state.searchProdutoEmbalagemIds.includes("salg-un"));
        assert.ok(state.searchProdutoEmbalagemIds.includes("heineken-id"));
    });

    it("fila vazia não muda estado", () => {
        const s = baseState({ bootstrapPendingClarifications: [] });
        const { state, outbound } = dequeueBootstrapClarification(s);
        assert.equal(outbound.length, 0);
        assert.equal(state, s);
    });
});
