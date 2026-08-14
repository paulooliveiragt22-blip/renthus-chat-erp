import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    applyFulfillmentPolicyToDraft,
    applyPickupTotals,
    assertFulfillmentAllowed,
    loadFulfillmentPolicyFromRow,
    needsFulfillmentChoice,
    nextMenuCheckoutStep,
    parseFulfillmentType,
    resolveSoleFulfillmentType,
} from "../../lib/delivery/fulfillment";
import type { OrderDraft } from "../../src/types/contracts";

function draft(overrides: Partial<OrderDraft> = {}): OrderDraft {
    return {
        items: [
            {
                produtoEmbalagemId: "pe-1",
                productName: "X",
                quantity: 2,
                unitPrice: 10,
                fatorConversao: 1,
                productVolumeId: null,
                estoqueUnidades: 9,
            },
        ],
        address: null,
        paymentMethod: null,
        changeFor: null,
        deliveryFee: 8,
        deliveryZoneId: "z",
        deliveryAddressText: null,
        deliveryMinOrder: 50,
        deliveryEtaMin: 40,
        totalItems: 20,
        grandTotal: 28,
        pendingConfirmation: false,
        version: 1,
        ...overrides,
    };
}

describe("fulfillment domain", () => {
    it("parseFulfillmentType aceita pt-BR e inglês", () => {
        assert.equal(parseFulfillmentType("entrega"), "delivery");
        assert.equal(parseFulfillmentType("Retirar"), "pickup");
        assert.equal(parseFulfillmentType("nope"), null);
    });

    it("loadFulfillmentPolicyFromRow trata null/false com default true", () => {
        assert.deepEqual(loadFulfillmentPolicyFromRow(null), {
            deliveriesEnabled: true,
            pickupEnabled: true,
        });
        assert.deepEqual(
            loadFulfillmentPolicyFromRow({ deliveries_enabled: false, pickup_enabled: true }),
            { deliveriesEnabled: false, pickupEnabled: true }
        );
    });

    it("resolveSole / needsChoice / nextMenuCheckoutStep", () => {
        assert.equal(
            resolveSoleFulfillmentType({ deliveriesEnabled: true, pickupEnabled: false }),
            "delivery"
        );
        assert.equal(
            resolveSoleFulfillmentType({ deliveriesEnabled: false, pickupEnabled: true }),
            "pickup"
        );
        assert.equal(
            resolveSoleFulfillmentType({ deliveriesEnabled: true, pickupEnabled: true }),
            null
        );
        assert.equal(
            needsFulfillmentChoice({ deliveriesEnabled: true, pickupEnabled: true }, null),
            true
        );
        assert.equal(
            needsFulfillmentChoice({ deliveriesEnabled: true, pickupEnabled: true }, "pickup"),
            false
        );
        assert.equal(
            nextMenuCheckoutStep({ deliveriesEnabled: true, pickupEnabled: true }),
            "fulfillment"
        );
        assert.equal(
            nextMenuCheckoutStep({ deliveriesEnabled: false, pickupEnabled: true }),
            "payment"
        );
        assert.equal(
            nextMenuCheckoutStep({ deliveriesEnabled: true, pickupEnabled: false }),
            "address"
        );
        assert.equal(
            nextMenuCheckoutStep({ deliveriesEnabled: false, pickupEnabled: false }),
            "unavailable"
        );
    });

    it("assertFulfillmentAllowed bloqueia modo desligado", () => {
        assert.equal(
            assertFulfillmentAllowed({ deliveriesEnabled: false, pickupEnabled: true }, "delivery")
                .ok,
            false
        );
        assert.equal(
            assertFulfillmentAllowed({ deliveriesEnabled: false, pickupEnabled: true }, "pickup").ok,
            true
        );
    });

    it("applyPickupTotals zera taxa e mínimo", () => {
        const next = applyPickupTotals(draft());
        assert.equal(next.fulfillmentType, "pickup");
        assert.equal(next.deliveryFee, 0);
        assert.equal(next.deliveryMinOrder, null);
        assert.equal(next.grandTotal, 20);
        assert.equal(next.deliveryAddressText, "Retirada no local");
    });

    it("applyFulfillmentPolicyToDraft aplica modo único da loja", () => {
        const pickupOnly = applyFulfillmentPolicyToDraft(draft(), {
            deliveriesEnabled: false,
            pickupEnabled: true,
        });
        assert.equal(pickupOnly.fulfillmentType, "pickup");
        assert.equal(pickupOnly.deliveryFee, 0);

        const deliveryOnly = applyFulfillmentPolicyToDraft(draft(), {
            deliveriesEnabled: true,
            pickupEnabled: false,
        });
        assert.equal(deliveryOnly.fulfillmentType, "delivery");
        assert.equal(deliveryOnly.deliveryFee, 8);
    });
});
