import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";
import { checkoutPostProcess } from "../../src/pro/pipeline/stages/checkoutPostProcess";
import { replaceHoldingOnlyReply } from "../../src/pro/pipeline/holdingReply";

function draft(overrides: Partial<OrderDraft> = {}): OrderDraft {
    return {
        items: [
            {
                produtoEmbalagemId: "pe-1",
                productName: "Skol",
                quantity: 2,
                unitPrice: 10,
                fatorConversao: 1,
                productVolumeId: null,
                estoqueUnidades: 9,
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
        totalItems: 20,
        grandTotal: 20,
        pendingConfirmation: false,
        version: 1,
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

describe("modalidade no checkout", () => {
    it("entrega já dita não mostra Entrega/Retirar", () => {
        const result = checkoutPostProcess({
            state: state({ draft: draft({ fulfillmentType: "delivery" }) }),
            outbound: [{ kind: "text", text: "Anotei 2 Skol." }],
            mode: "ai",
        });
        const buttons = result.outbound.filter((m) => m.kind === "buttons");
        assert.equal(buttons.length, 0);
        assert.equal(
            result.outbound.some((m) => /como você prefere receber/i.test(m.text ?? "")),
            false
        );
    });

    it("sem modalidade, o card Entrega/Retirar continua", () => {
        const result = checkoutPostProcess({
            state: state(),
            outbound: [{ kind: "text", text: "Anotei 2 Skol." }],
            mode: "ai",
        });
        assert.equal(
            result.outbound.some((m) =>
                m.buttons?.some((b) => b.id === "pro_fulfillment_delivery")
            ),
            true
        );
    });
});

describe("frase de espera", () => {
    it("um momento sem catálogo vira pergunta", () => {
        const out = checkoutPostProcess({
            state: state({ draft: null, step: "pro_idle" }),
            outbound: [
                {
                    kind: "text",
                    text: "Vou procurar as marmitas — um momento!",
                },
            ],
            mode: "ai",
            replaceUnfulfilledHoldingReply: true,
        });
        assert.equal(out.outbound.length, 1);
        assert.equal(out.outbound[0]?.text, "Qual produto você quer?");
    });

    it("um momento com preço e sem item no carrinho também vira pergunta", () => {
        const out = checkoutPostProcess({
            state: state({ draft: null, step: "pro_idle" }),
            outbound: [
                {
                    kind: "text",
                    text: "Vou montar 2 marmitas G (R$ 45 cada). Um momento!",
                },
            ],
            mode: "ai",
            replaceUnfulfilledHoldingReply: true,
        });
        assert.equal(out.outbound[0]?.text, "Qual produto você quer?");
    });

    it("preço na frase não é espera", () => {
        const kept = replaceHoldingOnlyReply([
            { kind: "text", text: "Um momento, a Skol está R$ 10,00." },
        ]);
        assert.match(kept[0]?.text ?? "", /R\$ 10/);
    });
});
