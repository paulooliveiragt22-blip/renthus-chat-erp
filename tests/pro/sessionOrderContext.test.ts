import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    clearStaleClarifyUiIfNoDraft,
    isOrderSessionContinuityNeeded,
} from "../../src/pro/pipeline/sessionOrderContext";
import type { ProSessionState } from "../../src/types/contracts";

function base(over: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_collecting_order",
        customerId: null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...over,
    };
}

describe("sessionOrderContext clarify soft-reset", () => {
    it("continuity true com lastSearchPicks>=2 sem draft", () => {
        assert.equal(
            isOrderSessionContinuityNeeded(
                base({
                    lastSearchPicks: [
                        { embalagemId: "a", label: "UN" },
                        { embalagemId: "b", label: "CX" },
                    ],
                })
            ),
            true
        );
    });

    it("clearStaleClarifyUiIfNoDraft zera picks residuais", () => {
        const out = clearStaleClarifyUiIfNoDraft(
            base({
                lastSearchPicks: [
                    { embalagemId: "a", label: "SALGADINHO" },
                    { embalagemId: "b", label: "CX" },
                ],
                searchProdutoEmbalagemIds: ["a", "b"],
                pendingClarifyQuantity: 2,
                pendingClarifySegment: "salgadinho",
            })
        );
        assert.deepEqual(out.lastSearchPicks, []);
        assert.deepEqual(out.searchProdutoEmbalagemIds, []);
        assert.equal(out.pendingClarifyQuantity, null);
        assert.equal(out.step, "pro_idle");
    });

    it("não limpa se já há itens no draft", () => {
        const withItems = clearStaleClarifyUiIfNoDraft(
            base({
                lastSearchPicks: [
                    { embalagemId: "a", label: "UN" },
                    { embalagemId: "b", label: "CX" },
                ],
                draft: {
                    items: [
                        {
                            produtoEmbalagemId: "x",
                            productName: "X",
                            quantity: 1,
                            unitPrice: 1,
                            fatorConversao: 1,
                            productVolumeId: null,
                            estoqueUnidades: 10,
                        },
                    ],
                    address: null,
                    paymentMethod: null,
                    changeFor: null,
                    deliveryFee: 0,
                    deliveryZoneId: null,
                    deliveryAddressText: null,
                    deliveryMinOrder: null,
                    deliveryEtaMin: null,
                    totalItems: 1,
                    grandTotal: 1,
                    pendingConfirmation: false,
                    version: 1,
                },
            })
        );
        assert.equal(withItems.lastSearchPicks?.length, 2);
    });
});
