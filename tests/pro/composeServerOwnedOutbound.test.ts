import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft, OutboundMessage, ProSessionState } from "../../src/types/contracts";
import { composeServerOwnedOutbound } from "../../src/pro/pipeline/composeServerOwnedOutbound";
import { HOLDING_REPLY_FALLBACK_PT } from "../../src/pro/pipeline/holdingReply";
import { checkoutPostProcess } from "../../src/pro/pipeline/stages/checkoutPostProcess";

describe("composeServerOwnedOutbound", () => {
    it("sem cartão, a prosa do modelo permanece", () => {
        const model: OutboundMessage = { kind: "text", text: "Temos marmita G. Quer pedir?" };
        const out = composeServerOwnedOutbound({
            messages: [model],
            modelMessages: new Set([model]),
        });
        assert.deepEqual(out, [model]);
    });

    it("com botão do servidor, a prosa do modelo sai e o resumo fica", () => {
        const model: OutboundMessage = {
            kind: "text",
            text: "Ótimo, vou anotar 2 marmitas G. Qual o endereço?",
        };
        const card: OutboundMessage = {
            kind: "buttons",
            text: "O endereço de entrega é Rua Turmalina, 34?",
            buttons: [
                { id: "pro_confirm_saved_address", title: "Confirmar" },
                { id: "pro_new_address_flow", title: "Novo" },
            ],
        };
        const notice: OutboundMessage = {
            kind: "text",
            text: "Faltam R$ 10,00 para o mínimo de entrega.",
        };
        const out = composeServerOwnedOutbound({
            messages: [model, notice, card],
            modelMessages: new Set([model]),
        });
        assert.deepEqual(out, [notice, card]);
    });

    it("cartão anexado depois tira a pergunta de produto que substituiu a espera", () => {
        const model: OutboundMessage = { kind: "text", text: "Um momento, a marmita está R$ 45." };
        const held = composeServerOwnedOutbound({
            messages: [model],
            modelMessages: new Set([model]),
            replaceUnfulfilledHolding: true,
        });
        assert.equal(held[0]?.text, HOLDING_REPLY_FALLBACK_PT);
        const card: OutboundMessage = {
            kind: "buttons",
            text: "Como você prefere receber este pedido?",
            buttons: [{ id: "pro_fulfillment_delivery", title: "Entrega" }],
        };
        const out = composeServerOwnedOutbound({
            messages: [...held, card],
            modelMessages: new Set([model]),
            replaceUnfulfilledHolding: true,
        });
        assert.deepEqual(out, [card]);
    });

    it("um momento com preço e sem cartão vira pergunta de produto", () => {
        const model: OutboundMessage = {
            kind: "text",
            text: "Vou montar 2 marmitas G (R$ 45 cada). Um momento!",
        };
        const out = composeServerOwnedOutbound({
            messages: [model],
            modelMessages: new Set([model]),
            replaceUnfulfilledHolding: true,
        });
        assert.equal(out.length, 1);
        assert.equal(out[0]?.text, HOLDING_REPLY_FALLBACK_PT);
    });
});

function draft(overrides: Partial<OrderDraft> = {}): OrderDraft {
    return {
        items: [
            {
                produtoEmbalagemId: "pe-1",
                productName: "Marmita G",
                quantity: 2,
                unitPrice: 45,
                fatorConversao: 1,
                productVolumeId: null,
                estoqueUnidades: 9,
            },
        ],
        address: {
            logradouro: "Rua Turmalina",
            numero: "34",
            bairro: "São Mateus",
            cidade: "Sorriso",
            estado: "MT",
            complemento: null,
            apelido: null,
            cep: null,
            enderecoClienteId: "end-1",
        },
        paymentMethod: null,
        changeFor: null,
        deliveryFee: 15,
        deliveryZoneId: "z1",
        deliveryAddressText: "Rua Turmalina, 34",
        deliveryMinOrder: null,
        deliveryEtaMin: 40,
        totalItems: 90,
        grandTotal: 105,
        pendingConfirmation: false,
        fulfillmentType: "delivery",
        version: 1,
        ...overrides,
    };
}

describe("checkoutPostProcess — boca do servidor", () => {
    it("resumo com prosa do modelo devolve só o card", () => {
        const model: OutboundMessage = {
            kind: "text",
            text: "Ótimo, vou anotar 2 marmitas G por R$ 45 cada.",
        };
        const session: ProSessionState = {
            step: "pro_awaiting_cart_review",
            customerId: "c1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: draft(),
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
            deliveryAddressUiConfirmed: true,
            cartReviewAcknowledged: false,
        };
        const out = checkoutPostProcess({
            state: session,
            outbound: [model],
            mode: "ai",
            modelOutbound: [model],
        });
        assert.equal(
            out.outbound.some((m) => /marmitas G por/i.test(m.text ?? "")),
            false
        );
        assert.equal(
            out.outbound.some((m) => m.buttons?.some((b) => b.id === "pro_confirm_order")),
            true
        );
    });
});
