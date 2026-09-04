import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";
import {
    resolveProStepFromDraft,
    withResolvedSlotStep,
    withResolvedSlotStepUnlessAwaitingConfirmation,
} from "../../src/pro/pipeline/orderSlotStep";

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
                estoqueUnidades: 99,
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
        fulfillmentType: "delivery",
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: 10,
        grandTotal: 10,
        pendingConfirmation: true,
        version: 1,
        ...overrides,
    };
}

describe("orderSlotStep / resolveProStepFromDraft", () => {
    it("sem itens mantém idle quando já idle", () => {
        assert.equal(
            resolveProStepFromDraft({ step: "pro_idle", draft: null }),
            "pro_idle"
        );
    });

    it("sem modo de recebimento: não avança pra pagamento mesmo com endereço completo", () => {
        assert.equal(
            resolveProStepFromDraft({
                step: "pro_collecting_order",
                draft: draft({ fulfillmentType: null }),
            }),
            "pro_collecting_order"
        );
    });

    it("endereço completo sem pagamento: vai direto a payment (sem confirmar endereço)", () => {
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: draft() }),
            "pro_awaiting_payment_method"
        );
    });

    it("endereço salvo completo sem pagamento: payment method", () => {
        const d = draft({
            address: {
                logradouro: "Rua A",
                numero: "1",
                bairro: "Centro",
                cidade: "Sorriso",
                estado: "MT",
                complemento: null,
                enderecoClienteId: "addr-1",
            },
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: d }),
            "pro_awaiting_payment_method"
        );
    });

    it("endereço completo com deliveryAddressUiConfirmed false: aguarda confirmação UI", () => {
        const d = draft({
            address: {
                logradouro: "Rua A",
                numero: "1",
                bairro: "Centro",
                cidade: "Sorriso",
                estado: "MT",
                complemento: null,
                enderecoClienteId: "addr-1",
            },
        });
        assert.equal(
            resolveProStepFromDraft({
                step: "pro_collecting_order",
                draft: d,
                deliveryAddressUiConfirmed: false,
            }),
            "pro_awaiting_address_confirmation"
        );
        const next = withResolvedSlotStep({
            step: "pro_collecting_order",
            customerId: "c1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: d,
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
            proposedAddressId: "addr-1",
            pendingAddressPickOptions: [],
            deliveryAddressUiConfirmed: false,
        });
        assert.equal(next.step, "pro_awaiting_address_confirmation");
        assert.equal(next.deliveryAddressUiConfirmed, false);
    });

    it("mantém pro_awaiting_payment_method", () => {
        assert.equal(
            resolveProStepFromDraft({ step: "pro_awaiting_payment_method", draft: draft() }),
            "pro_awaiting_payment_method"
        );
    });

    it("com clarificação de produto pendente não avança para pagamento", () => {
        assert.equal(
            resolveProStepFromDraft({
                step: "pro_collecting_order",
                draft: draft(),
                hasPendingProductClarify: true,
            }),
            "pro_collecting_order"
        );
        const next = withResolvedSlotStep({
            step: "pro_collecting_order",
            customerId: "c1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: draft(),
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
            lastSearchPicks: [
                { embalagemId: "a", label: "UN" },
                { embalagemId: "b", label: "CX" },
            ],
        });
        assert.equal(next.step, "pro_collecting_order");
    });

    it("abaixo do pedido mínimo: fica em collecting mesmo com endereço completo (não pede pagamento)", () => {
        const d = draft({ deliveryMinOrder: 50, grandTotal: 10, totalItems: 10 });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: d }),
            "pro_collecting_order"
        );
    });

    it("abaixo do pedido mínimo mesmo já com pagamento escolhido: não avança pra confirmação/troco", () => {
        const dPix = draft({
            paymentMethod: "pix",
            deliveryMinOrder: 50,
            grandTotal: 10,
            totalItems: 10,
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: dPix }),
            "pro_collecting_order"
        );
        const dCash = draft({
            paymentMethod: "cash",
            changeFor: null,
            deliveryMinOrder: 50,
            grandTotal: 10,
            totalItems: 10,
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: dCash }),
            "pro_collecting_order"
        );
    });

    it("dinheiro sem troco: awaiting_change_amount", () => {
        const d = draft({
            paymentMethod: "cash",
            changeFor: null,
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: d }),
            "pro_awaiting_change_amount"
        );
    });

    it("rascunho completo com pix: confirmação final (sem hold de endereço)", () => {
        const d = draft({
            paymentMethod: "pix",
            changeFor: null,
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: d }),
            "pro_awaiting_confirmation"
        );
    });

    it("pro_escalation_choice com rascunho completo: confirmação final", () => {
        const d = draft({
            paymentMethod: "pix",
            changeFor: null,
            pendingConfirmation: false,
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_escalation_choice", draft: d }),
            "pro_awaiting_confirmation"
        );
    });

    it("withResolvedSlotStep auto-confirma endereço e vai ao resumo", () => {
        const s: ProSessionState = {
            step: "pro_collecting_order",
            customerId: "c1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: draft({ paymentMethod: "pix", deliveryFee: 15, grandTotal: 25 }),
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
        };
        const next = withResolvedSlotStep(s);
        assert.equal(next.deliveryAddressUiConfirmed, true);
        assert.equal(next.step, "pro_awaiting_confirmation");
    });

    it("withResolvedSlotStepUnlessAwaitingConfirmation não desce o passo", () => {
        const s: ProSessionState = {
            step: "pro_awaiting_confirmation",
            customerId: "c1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: null,
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
        };
        assert.equal(withResolvedSlotStepUnlessAwaitingConfirmation(s).step, "pro_awaiting_confirmation");
    });
});

/**
 * C1.4 — matriz “mensagem curta / estado de draft → ProStep”.
 * Não simula NLU; valida que o slot machine (fonte de verdade) posiciona o checkout
 * para respostas curtas (“2”, “pix”, “o de sempre”) quando o draft já carrega o efeito.
 */
describe("orderSlotStep C1.4 matriz curta (draft → step)", () => {
    it("qty já no draft (cliente disse “2”): collecting → payment se endereço+fulfillment ok", () => {
        const d = draft({
            items: [
                {
                    produtoEmbalagemId: "pe-1",
                    productName: "X",
                    quantity: 2,
                    unitPrice: 10,
                    fatorConversao: 1,
                    productVolumeId: null,
                    estoqueUnidades: 99,
                },
            ],
            totalItems: 20,
            grandTotal: 20,
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: d }),
            "pro_awaiting_payment_method"
        );
    });

    it("pix já no draft (cliente disse “pix”): → confirmação", () => {
        assert.equal(
            resolveProStepFromDraft({
                step: "pro_awaiting_payment_method",
                draft: draft({ paymentMethod: "pix" }),
            }),
            "pro_awaiting_confirmation"
        );
    });

    it("dinheiro sem troco (cliente escolheu cash): → awaiting_change_amount", () => {
        assert.equal(
            resolveProStepFromDraft({
                step: "pro_awaiting_payment_method",
                draft: draft({ paymentMethod: "cash", changeFor: null }),
            }),
            "pro_awaiting_change_amount"
        );
    });

    it("endereço incompleto (ainda coletando “o de sempre” sem resolve): collecting", () => {
        assert.equal(
            resolveProStepFromDraft({
                step: "pro_collecting_order",
                draft: draft({
                    address: {
                        logradouro: "Rua A",
                        numero: "",
                        bairro: "Centro",
                        cidade: "Sorriso",
                        estado: "MT",
                        complemento: null,
                    },
                }),
            }),
            "pro_collecting_order"
        );
    });

    it("retirada: sem endereço → payment quando payment null", () => {
        assert.equal(
            resolveProStepFromDraft({
                step: "pro_collecting_order",
                draft: draft({
                    fulfillmentType: "pickup",
                    address: null,
                    paymentMethod: null,
                }),
            }),
            "pro_awaiting_payment_method"
        );
    });

    it("sem fulfillment ainda: collecting mesmo com endereço completo", () => {
        assert.equal(
            resolveProStepFromDraft({
                step: "pro_collecting_order",
                draft: draft({ fulfillmentType: null }),
            }),
            "pro_collecting_order"
        );
    });
});
