import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyProductPickFromInbound, PICK_EMB_PREFIX } from "../../src/pro/pipeline/productPickText";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";

function stateWithBothSalgadinhos(): ProSessionState {
    const draft: OrderDraft = {
        items: [
            {
                produtoEmbalagemId: "burger",
                productName: "BURGER",
                quantity: 1,
                unitPrice: 25,
                fatorConversao: 1,
                productVolumeId: null,
                estoqueUnidades: 5,
            },
            {
                produtoEmbalagemId: "salg-un",
                productName: "SALGADINHO",
                quantity: 1,
                unitPrice: 15,
                fatorConversao: 1,
                productVolumeId: null,
                estoqueUnidades: 5,
            },
            {
                produtoEmbalagemId: "salg-cx",
                productName: "SALGADINHO CX",
                quantity: 1,
                unitPrice: 220,
                fatorConversao: 15,
                productVolumeId: null,
                estoqueUnidades: 5,
            },
        ],
        address: null,
        paymentMethod: "pix",
        changeFor: null,
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: 260,
        grandTotal: 260,
        pendingConfirmation: false,
        currency: "BRL",
    };
    return {
        step: "pro_collecting_order",
        customerId: null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft,
        aiHistory: [],
        searchProdutoEmbalagemIds: ["salg-un", "salg-cx"],
        bootstrapResolvedEmbalagemIds: ["burger", "salg-un", "salg-cx"],
        lastSearchPicks: [
            { embalagemId: "salg-un", label: "SALGADINHO", price: 15 },
            { embalagemId: "salg-cx", label: "SALGADINHO CX", price: 220 },
        ],
    };
}

describe("applyProductPickFromInbound reject siblings", () => {
    it("ao escolher UN remove CX do draft e do bootstrap", () => {
        const { state, syntheticUserText } = applyProductPickFromInbound(
            `${PICK_EMB_PREFIX}salg-un`,
            stateWithBothSalgadinhos()
        );
        assert.ok(syntheticUserText);
        const ids = (state.draft?.items ?? []).map((i) => i.produtoEmbalagemId);
        assert.ok(ids.includes("salg-un"));
        assert.ok(!ids.includes("salg-cx"));
        assert.ok(!(state.bootstrapResolvedEmbalagemIds ?? []).includes("salg-cx"));
        assert.ok((state.bootstrapResolvedEmbalagemIds ?? []).includes("burger"));
    });
});
