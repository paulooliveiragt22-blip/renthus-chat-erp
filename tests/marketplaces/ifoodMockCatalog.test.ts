import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMockIfoodCatalog } from "../../src/marketplaces/adapters/ifood/ifoodCatalog.adapter";

describe("ifood mock catalog", () => {
    it("retorna itens com preço e categoria", () => {
        const snap = buildMockIfoodCatalog("merchant-1");
        assert.equal(snap.provider, "ifood");
        assert.equal(snap.merchantId, "merchant-1");
        assert.ok(snap.items.length >= 3);
        assert.ok(snap.items.every((i) => i.price >= 0 && i.name && i.externalItemId));
        assert.ok(snap.items.some((i) => i.externalItemId === "mock-item-combo-burger"));
    });
});
