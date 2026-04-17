import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";
import { applyQuickAction } from "../../src/pro/pipeline/stages/checkoutPostProcess";

function minimalDraft(overrides: Partial<OrderDraft> = {}): OrderDraft {
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
            complemento: null,
        },
        paymentMethod: null,
        changeFor: null,
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: 10,
        grandTotal: 10,
        pendingConfirmation: false,
        version: 1,
        ...overrides,
    };
}

function state(overrides: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_idle",
        customerId: "c1",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...overrides,
    };
}

describe("applyQuickAction — confirmação órfã e pagamento em texto", () => {
    it("pro_confirm_order sem draft em idle: não passa pela IA", () => {
        const r = applyQuickAction("pro_confirm_order", state({ step: "pro_idle", draft: null }));
        assert.equal(r.handled, true);
        assert.ok(r.outbound[0]?.kind === "text" && r.outbound[0].text?.includes("passo"));
    });

    it("pro_confirm_order sem draft em awaiting_confirmation: não consome (orderStage decide)", () => {
        const r = applyQuickAction(
            "pro_confirm_order",
            state({ step: "pro_awaiting_confirmation", draft: null })
        );
        assert.equal(r.handled, false);
    });

    it("Cartão em texto com draft+endereço: aplica como pro_pay_card", () => {
        const r = applyQuickAction(
            "Cartão",
            state({
                step: "pro_collecting_order",
                draft: minimalDraft(),
            })
        );
        assert.equal(r.handled, true);
        assert.equal(r.state.draft?.paymentMethod, "card");
    });

    it("cartao sem draft: não inventa pagamento", () => {
        const r = applyQuickAction("cartao", state({ draft: null }));
        assert.equal(r.handled, false);
    });
});
