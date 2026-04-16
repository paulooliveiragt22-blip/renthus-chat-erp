import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";
import { resolveProStepFromDraft, withResolvedSlotStep } from "../../src/pro/pipeline/orderSlotStep";

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

    it("sem enderecoClienteId e sem pagamento: aguarda forma de pagamento", () => {
        assert.equal(
            resolveProStepFromDraft({ step: "pro_collecting_order", draft: draft() }),
            "pro_awaiting_payment_method"
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

    it("withResolvedSlotStep aplica resolve", () => {
        const s: ProSessionState = {
            step: "pro_collecting_order",
            customerId: "c1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: draft({ paymentMethod: "pix" }),
            aiHistory: [],
        };
        assert.equal(withResolvedSlotStep(s).step, "pro_awaiting_confirmation");
    });
});
