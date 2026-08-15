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

    it("deliveryMinOrderHint none / below", () => {
        assert.equal(deliveryMinOrderHint(40, null).kind, "none");
        assert.equal(deliveryMinOrderHint(40, 0).kind, "none");
        assert.equal(deliveryMinOrderHint(50, 40).kind, "none");

        const below = deliveryMinOrderHint(25, 40);
        assert.equal(below.kind, "below");
        if (below.kind === "below") {
            assert.equal(below.missing, 15);
            assert.match(below.body, /Faltam/);
            assert.doesNotMatch(below.body, /retirar/i);
        }

        const withPickup = deliveryMinOrderHint(25, 40, { offerPickup: true });
        assert.equal(withPickup.kind, "below");
        if (withPickup.kind === "below") {
            assert.match(withPickup.body, /retirar no local/i);
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
