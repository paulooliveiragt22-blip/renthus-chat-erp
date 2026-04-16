import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildOrderCustomerMessage } from "../../src/pro/adapters/order/order.service.v2";
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
                productVolumeId: "pv-1",
                estoqueUnidades: 20,
            },
            {
                produtoEmbalagemId: "pe-2",
                productName: "Skol Lata",
                quantity: 1,
                unitPrice: 8,
                fatorConversao: 1,
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
    it("mensagem confirmada inclui itens, total, taxa e pagamento", () => {
        const text = buildOrderCustomerMessage({
            orderCode: "#ABC123",
            requireApproval: false,
            draft: sampleDraft(),
        });
        assert.ok(text.includes("Pedido #ABC123 confirmado."));
        assert.ok(text.includes("Itens: 2x Heineken 600ml; 1x Skol Lata."));
        assert.ok(text.includes("Total R$ 45,00 via PIX."));
        assert.ok(text.includes("Taxa R$ 5,00."));
    });

    it("mensagem pendente de aprovacao preserva resumo canônico", () => {
        const text = buildOrderCustomerMessage({
            orderCode: "#ABC123",
            requireApproval: true,
            draft: sampleDraft(),
        });
        assert.ok(text.includes("Pedido #ABC123 recebido."));
        assert.ok(text.includes("Estamos confirmando e ja voltamos."));
    });
});
