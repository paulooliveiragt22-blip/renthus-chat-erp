import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    formatFulfillmentLabel,
    isPickupFulfillment,
    orderFulfillmentAddressLine,
    PICKUP_ADDRESS_LABEL,
} from "../../lib/delivery/fulfillment";

describe("fulfillment labels", () => {
    it("formatFulfillmentLabel", () => {
        assert.equal(formatFulfillmentLabel("pickup"), "Retirada");
        assert.equal(formatFulfillmentLabel("delivery"), "Entrega");
        assert.equal(formatFulfillmentLabel(null), "Entrega");
    });

    it("pickup não usa endereço do cadastro", () => {
        assert.equal(
            orderFulfillmentAddressLine({
                fulfillmentType: "pickup",
                deliveryAddress: null,
                customerAddress: "Rua Casa 1",
            }),
            PICKUP_ADDRESS_LABEL
        );
        assert.equal(
            orderFulfillmentAddressLine({
                fulfillmentType: "pickup",
                deliveryAddress: "Retirada no local",
                customerAddress: "Rua Casa 1",
            }),
            "Retirada no local"
        );
    });

    it("delivery prefere delivery_address do pedido", () => {
        assert.equal(
            orderFulfillmentAddressLine({
                fulfillmentType: "delivery",
                deliveryAddress: "Rua Pedido 10",
                customerAddress: "Rua Cadastro",
            }),
            "Rua Pedido 10"
        );
        assert.ok(isPickupFulfillment("pickup"));
        assert.equal(isPickupFulfillment("delivery"), false);
    });
});
