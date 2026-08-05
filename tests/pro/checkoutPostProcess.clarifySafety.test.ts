import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";
import { checkoutPostProcess } from "../../src/pro/pipeline/stages/checkoutPostProcess";

function draft(): OrderDraft {
    return {
        items: [
            {
                produtoEmbalagemId: "pe-1",
                productName: "X",
                quantity: 1,
                unitPrice: 10,
                fatorConversao: 1,
                productVolumeId: null,
                estoqueUnidades: 9,
            },
        ],
        address: {
            logradouro: "Rua A",
            numero: "1",
            bairro: "Centro",
            cidade: "Sorriso",
            estado: "MT",
            complemento: null,
        },
        paymentMethod: "pix",
        changeFor: null,
        deliveryFee: 15,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: 10,
        grandTotal: 25,
        pendingConfirmation: true,
        currency: "BRL",
    };
}

describe("checkoutPostProcess clarify safety", () => {
    it("com lastSearchPicks e hold, emite botoes mesmo sem prosa da IA", () => {
        const state: ProSessionState = {
            step: "pro_collecting_order",
            customerId: null,
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: draft(),
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
            checkoutEditHold: true,
            lastSearchPicks: [
                { embalagemId: "t1", label: "TREZENTINHA", price: 5 },
                { embalagemId: "t2", label: "TREZENTINHA CX", price: 90 },
            ],
        };
        const out = checkoutPostProcess({
            state,
            outbound: [],
            mode: "ai",
        });
        assert.ok(out.outbound.some((m) => m.kind === "buttons"));
        assert.ok(
            out.outbound.some(
                (m) => m.kind === "buttons" && m.buttons?.some((b) => b.id.includes("t1"))
            )
        );
    });
});
