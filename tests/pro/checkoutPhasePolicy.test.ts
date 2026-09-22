import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    looksLikeCheckoutUiPollution,
    looksLikeFinalOrderConfirmAsk,
    scrubOutboundForAddressHold,
    scrubOutboundForFulfillmentChoice,
    scrubOutboundForServerPaymentUi,
} from "../../src/pro/tools/checkoutPhasePolicy";
import { checkoutPostProcess } from "../../src/pro/pipeline/stages/checkoutPostProcess";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";

describe("checkoutPhasePolicy", () => {
    it("detecta pedido de confirmacao final", () => {
        assert.equal(
            looksLikeFinalOrderConfirmAsk("Pedido pronto! Digite sim para confirmar o pedido."),
            true
        );
        assert.equal(looksLikeFinalOrderConfirmAsk("Qual sabor voce quer?"), false);
    });

    it("pollution: lista de opcoes / vou buscar / pedido de pagamento", () => {
        assert.equal(
            looksLikeCheckoutUiPollution(
                "Oi! Sobre a Original lata em caixa — temos a ORIGINAL LATA (CX c/15) a R$ 60. Tem mais duas opções: ORIGINAL 600ML. Qual você prefere? Enquanto isso, vou buscar a Heineken."
            ),
            true
        );
        assert.equal(
            looksLikeCheckoutUiPollution(
                "Perfeito! Anotei 2 caixas. Agora escolhe a forma de pagamento: PIX, Cartão ou Dinheiro?"
            ),
            true
        );
        assert.equal(looksLikeCheckoutUiPollution("Anotei 2x Original e 3x Heineken."), false);
    });

    it("fulfillment: descarta toda prosa da IA (só botões)", () => {
        const out = scrubOutboundForFulfillmentChoice([
            {
                kind: "text",
                text: "Oi! Sobre a Original lata — temos mais duas opções. Qual você prefere? Vou buscar a Heineken.",
            },
            {
                kind: "buttons",
                text: "Como você prefere receber este pedido?",
                buttons: [{ id: "pro_fulfillment_delivery", title: "Entrega" }],
            },
        ]);
        assert.equal(out.some((m) => m.kind === "text"), false);
        assert.ok(out.some((m) => m.kind === "buttons"));
    });

    it("pagamento: tira pedido de PIX na prosa", () => {
        const out = scrubOutboundForServerPaymentUi([
            { kind: "text", text: "Agora escolhe a forma de pagamento: PIX, Cartão ou Dinheiro?" },
            {
                kind: "buttons",
                text: "Escolha a forma de pagamento:",
                buttons: [{ id: "pro_pay_pix", title: "PIX" }],
            },
        ]);
        assert.ok(!out.some((m) => m.kind === "text"));
        assert.ok(out.some((m) => m.kind === "buttons"));
    });

    it("scrub remove prosa de confirmacao final", () => {
        const out = scrubOutboundForAddressHold([
            { kind: "text", text: "Resumo: 1x X. Confirme o pedido com um sim." },
            {
                kind: "buttons",
                text: "Confirma endereco?",
                buttons: [{ id: "pro_confirm_typed_address", title: "Confirmar" }],
            },
        ]);
        assert.ok(out.some((m) => m.kind === "buttons"));
        assert.ok(!out.some((m) => m.kind === "text" && looksLikeFinalOrderConfirmAsk(m.text ?? "")));
    });
});

describe("checkoutPostProcess — resumo final canónico", () => {
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
            fulfillmentType: "delivery" as const,
            deliveryFee: 5,
            deliveryZoneId: null,
            deliveryAddressText: "Rua A, 1",
            deliveryMinOrder: null,
            deliveryEtaMin: null,
            totalItems: 10,
            grandTotal: 15,
            pendingConfirmation: true,
            version: 1,
        };
    }

    it("com draft completo: card Confirmar inclui taxa; sem CTA de endereço", () => {
        const state: ProSessionState = {
            step: "pro_collecting_order",
            customerId: "c1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: draft(),
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
            deliveryAddressUiConfirmed: false,
        };
        const r = checkoutPostProcess({
            state,
            mode: "ai",
            outbound: [
                {
                    kind: "text",
                    text: "Seu pedido esta pronto. Confirme o pedido digitando sim.",
                },
            ],
        });
        assert.equal(r.state.step, "pro_awaiting_cart_review");
        const confirm = r.outbound.find(
            (m) => m.kind === "buttons" && (m.buttons ?? []).some((b) => b.id === "pro_confirm_order")
        );
        assert.ok(confirm);
        assert.match(String(confirm?.text ?? ""), /Taxa de entrega: R\$ 5,00/);
        assert.match(String(confirm?.text ?? ""), /Total: R\$ 15,00/);
        assert.ok(
            !r.outbound.some(
                (m) => m.kind === "buttons" && (m.buttons ?? []).some((b) => b.id.includes("address"))
            )
        );
    });
});
