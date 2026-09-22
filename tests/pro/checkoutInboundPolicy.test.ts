import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    fulfillmentTypeFromButtonInbound,
    isAddressOfferPassThrough,
    isCartReviewPassThrough,
    isClosedFulfillmentChoiceOpen,
    isEscalationPassThrough,
    isFulfillmentButtonInbound,
    isOosAddInbound,
    isOosContinueInbound,
} from "../../src/pro/pipeline/checkoutInboundPolicy";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";

function draft(overrides: Partial<OrderDraft> = {}): OrderDraft {
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
        fulfillmentType: null,
        ...overrides,
    };
}

function state(overrides: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_collecting_order",
        customerId: "c1",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: draft(),
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...overrides,
    };
}

describe("checkoutInboundPolicy", () => {
    it("fulfillment: só IDs e títulos exactos", () => {
        assert.equal(isFulfillmentButtonInbound("pro_fulfillment_delivery"), true);
        assert.equal(isFulfillmentButtonInbound("Entrega"), true);
        assert.equal(isFulfillmentButtonInbound("Retirar no local"), true);
        assert.equal(fulfillmentTypeFromButtonInbound("Retirar no local"), "pickup");
        assert.equal(isFulfillmentButtonInbound("retirada"), false);
        assert.equal(isFulfillmentButtonInbound("quero entrega e 2 skol"), false);
        assert.equal(fulfillmentTypeFromButtonInbound("retirada"), null);
    });

    it("OOS: só IDs e Sim/Não exactos", () => {
        assert.equal(isOosAddInbound("pro_oos_add_other"), true);
        assert.equal(isOosAddInbound("Sim"), true);
        assert.equal(isOosAddInbound("ss"), false);
        assert.equal(isOosAddInbound("yes"), false);
        assert.equal(isOosContinueInbound("Não"), true);
        assert.equal(isOosContinueInbound("n"), false);
    });

    it("resumo: prosa fraca não passa; revisão e botões passam", () => {
        assert.equal(isCartReviewPassThrough("sim"), false);
        assert.equal(isCartReviewPassThrough("sim pode fechar"), false);
        assert.equal(isCartReviewPassThrough("pro_confirm_order"), true);
        assert.equal(isCartReviewPassThrough("pro_edit_order"), true);
        assert.equal(isCartReviewPassThrough("quero 2 skol lata"), true);
        assert.equal(isCartReviewPassThrough("pro_pay_pix"), true);
    });

    it("escalação: IDs, atendente e cancelar", () => {
        assert.equal(isEscalationPassThrough("btn_support"), true);
        assert.equal(isEscalationPassThrough("atendente"), true);
        assert.equal(isEscalationPassThrough("Continuar pedido"), true);
        assert.equal(isEscalationPassThrough("cancelar"), true);
        assert.equal(isEscalationPassThrough("quero 2 skol"), false);
    });

    it("oferta de endereço: número e botões", () => {
        assert.equal(isAddressOfferPassThrough("2", 3), true);
        assert.equal(isAddressOfferPassThrough("9", 2), false);
        assert.equal(isAddressOfferPassThrough("pro_confirm_saved_address", 2), true);
        assert.equal(isAddressOfferPassThrough("Rua nova 10", 2), false);
    });

    it("escolha Entrega/Retirar aberta só com os dois modos e itens", () => {
        const both = { deliveriesEnabled: true, pickupEnabled: true };
        assert.equal(
            isClosedFulfillmentChoiceOpen(
                state({ draft: draft({ address: null, fulfillmentType: null }) }),
                both
            ),
            true
        );
        assert.equal(
            isClosedFulfillmentChoiceOpen(state({ draft: draft({ fulfillmentType: "delivery" }) }), both),
            false
        );
        assert.equal(
            isClosedFulfillmentChoiceOpen(state({ checkoutEditHold: true }), both),
            false
        );
        assert.equal(
            isClosedFulfillmentChoiceOpen(state(), { deliveriesEnabled: true, pickupEnabled: false }),
            false
        );
        assert.equal(
            isClosedFulfillmentChoiceOpen(
                state({ draft: draft({ deliveryMinOrder: 50, grandTotal: 10, address: null }) }),
                both
            ),
            false
        );
        assert.equal(
            isClosedFulfillmentChoiceOpen(state({ draft: draft() }), both),
            false,
            "endereço completo → entrega implícita, gate fechado"
        );
    });
});
