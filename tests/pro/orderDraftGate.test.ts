import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    hasPersistedDraftAndCustomer,
    isDraftStructurallyCompleteForFinalize,
} from "../../src/pro/pipeline/orderDraftGate";
import type { OrderDraft, ProSessionState } from "../../src/types/contracts";

function minimalDraft(overrides: Partial<OrderDraft> = {}): OrderDraft {
    return {
        items: [
            {
                produtoEmbalagemId: "pe-1",
                productName: "X",
                quantity: 1,
                unitPrice: 1,
                fatorConversao: 1,
                productVolumeId: "pv-1",
                estoqueUnidades: 10,
            },
        ],
        address: {
            logradouro: "Rua A",
            numero: "1",
            bairro: "Centro",
            complemento: null,
        },
        paymentMethod: "pix",
        changeFor: null,
        deliveryFee: 0,
        deliveryZoneId: "z",
        deliveryAddressText: "Rua A",
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: 1,
        grandTotal: 1,
        pendingConfirmation: true,
        version: 1,
        ...overrides,
    };
}

describe("orderDraftGate (R1)", () => {
    it("isDraftStructurallyCompleteForFinalize exige itens, endereço e pagamento", () => {
        assert.equal(isDraftStructurallyCompleteForFinalize(minimalDraft()), true);
        assert.equal(isDraftStructurallyCompleteForFinalize(minimalDraft({ items: [] })), false);
        assert.equal(isDraftStructurallyCompleteForFinalize(minimalDraft({ address: null })), false);
        assert.equal(isDraftStructurallyCompleteForFinalize(minimalDraft({ paymentMethod: null })), false);
    });

    it("hasPersistedDraftAndCustomer restringe o tipo quando true", () => {
        const s: ProSessionState = {
            step: "pro_awaiting_confirmation",
            customerId: "c1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: minimalDraft(),
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
        };
        if (hasPersistedDraftAndCustomer(s)) {
            assert.equal(typeof s.customerId, "string");
            assert.ok(s.draft);
        }
    });
});
