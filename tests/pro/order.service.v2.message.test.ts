import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildOrderErrorMessage,
    buildOrderCustomerMessage,
    isRetryableOrderError,
    validateDraftConsistency,
} from "../../src/pro/adapters/order/order.service.v2";
import type { OrderDraft } from "../../src/types/contracts";

function sampleDraft(): OrderDraft {
    return {
        items: [
            {
                produtoEmbalagemId: "pe-1",
                productName: "Heineken 600ml",
                quantity: 2,
                unitPrice: 16,
                fatorConversao: 1,
                siglaComercial: "UN",
                productVolumeId: "pv-1",
                estoqueUnidades: 20,
            },
            {
                produtoEmbalagemId: "pe-2",
                productName: "Skol Lata",
                quantity: 1,
                unitPrice: 8,
                fatorConversao: 1,
                siglaComercial: "UN",
                productVolumeId: "pv-2",
                estoqueUnidades: 20,
            },
        ],
        address: {
            logradouro: "Rua A",
            numero: "10",
            bairro: "Centro",
            complemento: null,
        },
        paymentMethod: "pix",
        changeFor: null,
        deliveryFee: 5,
        deliveryZoneId: "z1",
        deliveryAddressText: "Rua A, 10",
        deliveryMinOrder: null,
        deliveryEtaMin: 30,
        totalItems: 40,
        grandTotal: 45,
        pendingConfirmation: true,
        version: 1,
    };
}

describe("OrderServiceV2Adapter message snapshot", () => {
    it("mensagem confirmada usa o template do cardápio web", () => {
        const text = buildOrderCustomerMessage({
            orderCode: "#ABC123",
            requireApproval: false,
            draft: sampleDraft(),
        });
        assert.match(text, /✅ \*Pedido Confirmado!\*/);
        assert.match(text, /Pedido #ABC123/);
        assert.match(text, /• 2x Heineken 600ml \(UN\) — R\$\s*32,00/);
        assert.match(text, /• 1x Skol Lata \(UN\) — R\$\s*8,00/);
        assert.match(text, /🛵 Taxa de entrega: R\$\s*5,00/);
        assert.match(text, /📍 /);
        assert.match(text, /💳 PIX/);
        assert.match(text, /🚚 \*Previsão de entrega:\* 30 minutos/);
        assert.match(text, /Obrigado pela preferência! 🍺/);
        assert.ok(!text.includes("Total R$ 45,00 via PIX"));
    });

    it("mensagem pendente de aprovacao usa template Recebido do cardápio web", () => {
        const text = buildOrderCustomerMessage({
            orderCode: "#ABC123",
            requireApproval: true,
            draft: sampleDraft(),
        });
        assert.match(text, /✅ \*Pedido Recebido!\*/);
        assert.match(text, /Pedido #ABC123/);
        assert.match(text, /Total: R\$\s*45,00/);
        assert.match(text, /Estamos confirmando seu pedido/);
    });

    it("quando grandTotal vier inconsistente, mensagem usa total recomputado", () => {
        const draft = sampleDraft();
        draft.grandTotal = 999;
        const text = buildOrderCustomerMessage({
            orderCode: "#ABC123",
            requireApproval: true,
            draft,
        });
        assert.match(text, /Total: R\$\s*45,00/);
        assert.ok(!text.includes("999"));
    });
});

describe("OrderServiceV2Adapter consistency validation", () => {
    it("falha com totais inconsistentes (quebra antes: pedido poderia sair com total divergente)", () => {
        const draft = sampleDraft();
        draft.totalItems = 999;
        const out = validateDraftConsistency(draft);
        if (out.ok) throw new Error("esperava falha de consistência de totais");
    });

    it("falha com dados numéricos inválidos", () => {
        const draft = sampleDraft();
        const first = draft.items[0];
        if (!first) throw new Error("draft de teste precisa de pelo menos um item");
        first.quantity = 0;
        const out = validateDraftConsistency(draft);
        if (out.ok) throw new Error("esperava falha de consistência numérica");
    });
});

describe("OrderServiceV2Adapter retryability policy", () => {
    it("marca apenas RPC_ERROR e DB_ERROR como retryable", () => {
        assert.equal(isRetryableOrderError("RPC_ERROR"), true);
        assert.equal(isRetryableOrderError("DB_ERROR"), true);
        assert.equal(isRetryableOrderError("PRODUCT_NOT_FOUND"), false);
        assert.equal(isRetryableOrderError("INVALID_ADDRESS"), false);
        assert.equal(isRetryableOrderError("INCONSISTENT_DRAFT"), false);
    });
});

describe("OrderServiceV2Adapter canonical error messages", () => {
    it("padroniza PRODUCT_NOT_FOUND e INCONSISTENT_DRAFT", () => {
        assert.equal(
            buildOrderErrorMessage("PRODUCT_NOT_FOUND"),
            "Não encontramos esse produto ou embalagem no catálogo. Confirme o item ou escolha outro."
        );
        assert.equal(
            buildOrderErrorMessage("INCONSISTENT_DRAFT"),
            "Dados inconsistentes do pedido. Revise os itens e tente novamente."
        );
    });

    it("aceita contexto para OUT_OF_STOCK", () => {
        assert.equal(buildOrderErrorMessage("OUT_OF_STOCK", { itemName: "Coca 2L" }), 'Estoque insuficiente para "Coca 2L".');
    });
});
