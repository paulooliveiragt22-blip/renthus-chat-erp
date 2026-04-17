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

    it("com endereco salvo e sem pagamento: collecting → confirmação de endereço", () => {
        const d = draft({
            address: {
                logradouro: "Rua A",
                numero: "1",
                bairro: "Centro",
                complemento: null,
                enderecoClienteId: "addr-1",
            },
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: d }),
            "pro_awaiting_address_confirmation"
        );
    });

    it("sem enderecoClienteId e sem pagamento: aguarda confirmação do endereço digitado", () => {
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: draft() }),
            "pro_awaiting_address_confirmation"
        );
    });

    it("mantém pro_awaiting_payment_method após confirmar endereço salvo (evita regressão)", () => {
        const d = draft({
            address: {
                logradouro: "Rua A",
                numero: "1",
                bairro: "Centro",
                complemento: null,
                enderecoClienteId: "addr-1",
            },
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_awaiting_payment_method", draft: d }),
            "pro_awaiting_payment_method"
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

    it("rascunho completo com pagamento não-dinheiro: confirmação final", () => {
        const d = draft({
            paymentMethod: "pix",
            changeFor: null,
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: d }),
            "pro_awaiting_confirmation"
        );
    });

    it("rascunho estruturalmente completo sem pendingConfirmation: ainda vai para confirmação final", () => {
        const d = draft({
            paymentMethod: "pix",
            changeFor: null,
            pendingConfirmation: false,
        });
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: d }),
            "pro_awaiting_confirmation"
        );
    });

    it("pro_escalation_choice sem itens: mantém escolha", () => {
        assert.equal(
            resolveProStepFromDraft({ step: "pro_escalation_choice", draft: null }),
            "pro_escalation_choice"
        );
    });

    it("pro_escalation_choice com rascunho completo: re-alinha para confirmação final", () => {
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

    it("withResolvedSlotStep aplica resolve", () => {
        const s: ProSessionState = {
            step: "pro_collecting_order",
            customerId: "c1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: draft({ paymentMethod: "pix" }),
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
        };
        assert.equal(withResolvedSlotStep(s).step, "pro_awaiting_confirmation");
    });

    it("withResolvedSlotStepUnlessAwaitingConfirmation não rebaixa de confirmation com draft null", () => {
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
