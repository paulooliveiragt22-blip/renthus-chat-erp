import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMockIfoodCatalog } from "../../src/marketplaces/adapters/ifood/ifoodCatalog.adapter";
import {
    flattenIfoodCatalogItem,
    isSyncableCatalogItem,
} from "../../src/marketplaces/adapters/ifood/flattenIfoodCatalogItems";
import { flattenIfoodOrderItems } from "../../src/marketplaces/adapters/ifood/flattenIfoodOrderItems";
import { ifoodOrdersAdapter } from "../../src/marketplaces/adapters/ifood/ifoodOrders.adapter";

describe("ifood F4.4 complements", () => {
    it("mock inclui combo com option groups e complementos", () => {
        const snap = buildMockIfoodCatalog("m1");
        const combo = snap.items.find((i) => i.externalItemId === "mock-item-combo-burger");
        assert.ok(combo);
        assert.ok((combo!.optionGroups?.length ?? 0) >= 1);
        assert.equal(combo!.optionGroups![0]!.optionExternalIds.length, 2);

        const complements = snap.items.filter((i) => i.isComplement);
        assert.equal(complements.length, 2);
        assert.ok(complements.every((c) => c.showOnMenu === false));
        assert.ok(complements.every((c) => c.parentExternalItemId === "mock-item-combo-burger"));
    });

    it("flatten live item extrai options aninhados", () => {
        const flat = flattenIfoodCatalogItem(
            {
                id: "item-1",
                name: "Pizza M",
                price: { value: 40 },
                status: "AVAILABLE",
                optionGroups: [
                    {
                        id: "og-1",
                        name: "Borda",
                        min: 0,
                        max: 1,
                        options: [
                            { id: "opt-catupiry", name: "Borda catupiry", price: 8 },
                            { id: "opt-cheddar", name: "Borda cheddar", price: 7 },
                        ],
                    },
                ],
            },
            "Pizzas",
            "cat-pizza"
        );
        assert.equal(flat.length, 3);
        assert.equal(flat[0]!.name, "Pizza M");
        assert.equal(flat[0]!.optionGroups?.[0]?.optionExternalIds.length, 2);
        assert.ok(flat[1]!.isComplement);
        assert.ok(isSyncableCatalogItem(flat[1]!));
        assert.ok(isSyncableCatalogItem({ ...flat[1]!, price: 0 }));
    });

    it("flatten pedido inclui options aninhados", () => {
        const lines = flattenIfoodOrderItems([
            {
                id: "item-1",
                name: "Combo",
                quantity: 1,
                unitPrice: 28.9,
                options: [{ id: "opt-batata", name: "Batata", quantity: 1, unitPrice: 8 }],
            },
        ]);
        assert.equal(lines.length, 2);
        assert.equal(lines[1]!.externalItemId, "opt-batata");
        assert.equal(lines[1]!.unitPrice, 8);
    });

    it("pedido mock inclui complemento batata", async () => {
        const order = await ifoodOrdersAdapter.fetchOrder({
            accessToken: "mock",
            externalOrderId: "mock-ord-abc",
            useMock: true,
        });
        assert.ok(order);
        assert.ok(order!.items.some((i) => i.externalItemId === "mock-opt-batata"));
        assert.ok(order!.items.some((i) => i.externalItemId === "mock-item-combo-burger"));
    });
});
