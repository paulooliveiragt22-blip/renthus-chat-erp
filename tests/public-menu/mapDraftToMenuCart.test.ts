import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapDraftToMenuCart } from "@/lib/public-menu/handoff/mapDraftToMenuCart";
import type { OrderDraft } from "@/src/types/contracts";

function draft(items: OrderDraft["items"]): OrderDraft {
    return {
        items,
        address: null,
        paymentMethod: null,
        changeFor: null,
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems: 0,
        grandTotal: 0,
        pendingConfirmation: false,
        version: 1,
    };
}

describe("mapDraftToMenuCart", () => {
    it("mapeia itens válidos e ignora qty inválida ou sem embalagem", () => {
        const cart = mapDraftToMenuCart(
            draft([
                {
                    produtoEmbalagemId: "pe-1",
                    productName: "Heineken UN",
                    quantity: 2,
                    unitPrice: 9.5,
                    fatorConversao: 1,
                    productVolumeId: "pv-1",
                    estoqueUnidades: 10,
                },
                {
                    produtoEmbalagemId: "",
                    productName: "sem id",
                    quantity: 1,
                    unitPrice: 1,
                    fatorConversao: 1,
                    productVolumeId: null,
                    estoqueUnidades: 0,
                },
                {
                    produtoEmbalagemId: "pe-2",
                    productName: "CX",
                    quantity: 0,
                    unitPrice: 40,
                    fatorConversao: 12,
                    productVolumeId: "pv-2",
                    estoqueUnidades: 5,
                },
            ])
        );
        assert.equal(cart.length, 1);
        assert.deepEqual(cart[0], {
            embalagemId: "pe-1",
            productId: "pv-1",
            name: "Heineken UN",
            sigla: "",
            fatorConversao: 1,
            unitPrice: 9.5,
            qty: 2,
        });
    });
});
