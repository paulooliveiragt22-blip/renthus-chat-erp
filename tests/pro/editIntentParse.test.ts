import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    looksLikePackagingOnlyHint,
    parseCheckoutSwapIntent,
} from "../../src/pro/pipeline/editIntentParse";
import type { OrderDraft } from "../../src/types/contracts";
import { removeDraftItemsMatchingName } from "../../src/pro/pipeline/mergeOrderDraft";

describe("parseCheckoutSwapIntent", () => {
    it("troca salgadinho pela caixa de 15 → query com salgadinho", () => {
        const s = parseCheckoutSwapIntent("troca o salgadinho pela caixa de 15");
        assert.ok(s);
        assert.equal(s!.removeName, "salgadinho");
        assert.match(s!.searchQuery, /salgadinho/);
        assert.match(s!.searchQuery, /caixa/);
    });

    it("substitui heineken por long neck unidade", () => {
        const s = parseCheckoutSwapIntent("substitui a heineken por long neck unidade");
        assert.ok(s);
        assert.ok(s!.removeName.includes("heineken"));
    });

    it("ignora texto que nao e troca", () => {
        assert.equal(parseCheckoutSwapIntent("quero um salgadinho"), null);
    });
});

describe("looksLikePackagingOnlyHint", () => {
    it("caixa de 15 e packaging-only", () => {
        assert.equal(looksLikePackagingOnlyHint("caixa de 15"), true);
        assert.equal(looksLikePackagingOnlyHint("heineken long neck"), false);
    });
});

describe("removeDraftItemsMatchingName", () => {
    it("remove salgadinho e mantem heineken/burger", () => {
        const draft: OrderDraft = {
            items: [
                {
                    produtoEmbalagemId: "h",
                    productName: "HEINEKEN LONGNECK (CX c/6)",
                    quantity: 1,
                    unitPrice: 60,
                    fatorConversao: 6,
                    productVolumeId: null,
                    estoqueUnidades: 10,
                },
                {
                    produtoEmbalagemId: "b",
                    productName: "HABURGUER ROSSEIRO BURGER X",
                    quantity: 1,
                    unitPrice: 25,
                    fatorConversao: 1,
                    productVolumeId: null,
                    estoqueUnidades: 10,
                },
                {
                    produtoEmbalagemId: "s",
                    productName: "SALGADINHO",
                    quantity: 1,
                    unitPrice: 15,
                    fatorConversao: 1,
                    productVolumeId: null,
                    estoqueUnidades: 10,
                },
            ],
            address: null,
            paymentMethod: "pix",
            changeFor: null,
            deliveryFee: 15,
            deliveryZoneId: null,
            deliveryAddressText: null,
            deliveryMinOrder: null,
            deliveryEtaMin: null,
            totalItems: 100,
            grandTotal: 115,
            pendingConfirmation: false,
            version: 1,
        };
        const next = removeDraftItemsMatchingName(draft, "salgadinho");
        assert.equal(next!.items.length, 2);
        assert.ok(next!.items.every((i) => !/salgadinho/i.test(i.productName)));
        assert.equal(next!.totalItems, 85);
    });
});
