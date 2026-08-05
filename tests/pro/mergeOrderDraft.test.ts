import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OrderDraft } from "../../src/types/contracts";
import {
    mergePreparedDraftIntoCurrent,
    unionAllowlistWithDraftIds,
} from "../../src/pro/pipeline/mergeOrderDraft";

function item(id: string, name: string, price = 10): OrderDraft["items"][number] {
    return {
        produtoEmbalagemId: id,
        productName: name,
        quantity: 1,
        unitPrice: price,
        fatorConversao: 1,
        productVolumeId: null,
        estoqueUnidades: 9,
    };
}

function draft(items: OrderDraft["items"], overrides: Partial<OrderDraft> = {}): OrderDraft {
    const totalItems = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    return {
        items,
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
        deliveryFee: 15,
        deliveryZoneId: "z1",
        deliveryAddressText: "Rua A, 1",
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems,
        grandTotal: totalItems + 15,
        pendingConfirmation: true,
        version: 1,
        ...overrides,
    };
}

describe("mergePreparedDraftIntoCurrent", () => {
    it("une itens do prepare com o draft atual (nao apaga SKUs anteriores)", () => {
        const current = draft([item("heineken", "Heineken", 60), item("burger", "Burger", 30)]);
        const prepared = draft([item("salgado", "Salgadinho", 15)]);
        const merged = mergePreparedDraftIntoCurrent(current, prepared);
        assert.ok(merged);
        assert.equal(merged!.items.length, 3);
        assert.ok(merged!.items.some((i) => i.produtoEmbalagemId === "heineken"));
        assert.ok(merged!.items.some((i) => i.produtoEmbalagemId === "burger"));
        assert.ok(merged!.items.some((i) => i.produtoEmbalagemId === "salgado"));
        assert.equal(merged!.grandTotal, 60 + 30 + 15 + 15);
    });

    it("atualiza quantidade do mesmo SKU", () => {
        const current = draft([item("a", "A", 10)]);
        const prepared = draft([{ ...item("a", "A", 10), quantity: 3 }]);
        const merged = mergePreparedDraftIntoCurrent(current, prepared);
        assert.equal(merged!.items[0]?.quantity, 3);
    });

    it("sem current usa prepared", () => {
        const prepared = draft([item("x", "X")]);
        assert.equal(mergePreparedDraftIntoCurrent(null, prepared), prepared);
    });
});

describe("unionAllowlistWithDraftIds", () => {
    it("inclui ids do draft na allowlist", () => {
        const d = draft([item("draft-1", "D1"), item("draft-2", "D2")]);
        const ids = unionAllowlistWithDraftIds(["search-1"], d);
        assert.deepEqual(ids, ["search-1", "draft-1", "draft-2"]);
    });
});
