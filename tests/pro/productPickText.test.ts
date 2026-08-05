import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    applyProductPickFromInbound,
    parseProductPickIndex,
    PICK_EMB_PREFIX,
} from "../../src/pro/pipeline/productPickText";
import type { ProSessionState } from "../../src/types/contracts";

const picks = [
    { embalagemId: "a", label: "UN", price: 10 },
    { embalagemId: "b", label: "CX6", price: 60 },
    { embalagemId: "c", label: "CX24", price: 336 },
];

function state(): ProSessionState {
    return {
        step: "pro_idle",
        customerId: null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: picks.map((p) => p.embalagemId),
        lastSearchPicks: picks,
    };
}

describe("parseProductPickIndex", () => {
    it("aceita 2, opcao 2, segunda", () => {
        assert.equal(parseProductPickIndex("2"), 2);
        assert.equal(parseProductPickIndex("Opção 2"), 2);
        assert.equal(parseProductPickIndex("opcao 2"), 2);
        assert.equal(parseProductPickIndex("segunda"), 2);
    });
});

describe("applyProductPickFromInbound", () => {
    it("botão pro_pick_emb", () => {
        const r = applyProductPickFromInbound(`${PICK_EMB_PREFIX}b`, state());
        assert.equal(r.state.searchProdutoEmbalagemIds[0], "b");
        assert.ok(r.syntheticUserText?.includes("b"));
        assert.equal(r.state.lastSearchPicks?.length ?? 0, 0);
    });

    it("texto Opção 2 → segunda embalagem", () => {
        const r = applyProductPickFromInbound("Opção 2", state());
        assert.equal(r.state.searchProdutoEmbalagemIds[0], "b");
        assert.ok(r.syntheticUserText?.includes("CX6"));
    });
});
