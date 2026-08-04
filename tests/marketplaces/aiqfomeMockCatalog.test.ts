import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildMockAiqfomeCatalog } from "../../src/marketplaces/adapters/aiqfome/aiqfomeCatalog.adapter";
import { ifoodOrdersAdapter } from "../../src/marketplaces/adapters/ifood/ifoodOrders.adapter";

describe("marketplace F3 mocks", () => {
    it("aiqfome catalog mock tem itens", () => {
        const snap = buildMockAiqfomeCatalog("loja-1");
        assert.equal(snap.provider, "aiqfome");
        assert.ok(snap.items.length >= 2);
    });

    it("ifood orders poll mock retorna PLC", async () => {
        const events = await ifoodOrdersAdapter.pollEvents({
            accessToken: "mock",
            merchantId: "m1",
            useMock: true,
        });
        assert.equal(events.length, 1);
        assert.equal(events[0]!.code, "PLC");
        const order = await ifoodOrdersAdapter.fetchOrder({
            accessToken: "mock",
            externalOrderId: events[0]!.orderId,
            useMock: true,
        });
        assert.ok(order);
        assert.ok((order?.items.length ?? 0) >= 1);
    });
});
