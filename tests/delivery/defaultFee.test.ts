import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    deliveryBaseFeeAmount,
    pickDeliveryFeeDefinition,
} from "@/lib/delivery/defaultFee";

describe("deliveryBaseFeeAmount", () => {
    it("returns 0 when missing or inactive", () => {
        assert.equal(deliveryBaseFeeAmount(null), 0);
        assert.equal(
            deliveryBaseFeeAmount({ is_active: false, calc_mode: "fixed", value: 10 }),
            0
        );
    });

    it("returns fixed value when active", () => {
        assert.equal(
            deliveryBaseFeeAmount({ is_active: true, calc_mode: "fixed", value: 7.5 }),
            7.5
        );
    });

    it("returns 0 for percent (needs subtotal at order time)", () => {
        assert.equal(
            deliveryBaseFeeAmount({ is_active: true, calc_mode: "percent", value: 10 }),
            0
        );
    });
});

describe("pickDeliveryFeeDefinition", () => {
    it("picks system_key=delivery", () => {
        const d = pickDeliveryFeeDefinition([
            { system_key: "service", id: "a" },
            { system_key: "delivery", id: "b" },
        ]);
        assert.equal(d?.id, "b");
    });
});
