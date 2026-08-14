import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    deliveryMinOrderCardLine,
    deliveryMinOrderHint,
    formatMenuMoneyBRL,
    soleFulfillmentNotice,
} from "@/lib/delivery/fulfillmentCopy";

describe("fulfillmentCopy", () => {
    it("soleFulfillmentNotice pickup vs delivery", () => {
        const pickup = soleFulfillmentNotice("pickup");
        assert.equal(pickup.type, "pickup");
        assert.match(pickup.title, /retirada/i);
        assert.match(pickup.cta, /pagamento/i);

        const delivery = soleFulfillmentNotice("delivery");
        assert.equal(delivery.type, "delivery");
        assert.match(delivery.title, /entregando/i);
        assert.match(delivery.cta, /endereço/i);
    });

    it("deliveryMinOrderHint none / info / below", () => {
        assert.equal(deliveryMinOrderHint(40, null).kind, "none");
        assert.equal(deliveryMinOrderHint(40, 0).kind, "none");

        const ok = deliveryMinOrderHint(50, 40);
        assert.equal(ok.kind, "info");
        if (ok.kind === "info") {
            assert.equal(ok.minOrder, 40);
            assert.match(ok.body, /atinge/i);
        }

        const below = deliveryMinOrderHint(25, 40);
        assert.equal(below.kind, "below");
        if (below.kind === "below") {
            assert.equal(below.missing, 15);
            assert.match(below.body, /Faltam/);
            assert.match(below.body, /retirar/i);
        }
    });

    it("deliveryMinOrderCardLine e formatMenuMoneyBRL", () => {
        assert.equal(deliveryMinOrderCardLine(null), null);
        assert.equal(deliveryMinOrderCardLine(0), null);
        const line = deliveryMinOrderCardLine(35);
        assert.ok(line);
        assert.match(line!, /Pedido mínimo/);
        assert.ok(line!.includes(formatMenuMoneyBRL(35)));
    });
});
