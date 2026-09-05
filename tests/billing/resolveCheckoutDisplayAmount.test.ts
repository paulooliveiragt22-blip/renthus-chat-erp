import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCheckoutDisplayAmountBrl } from "../../lib/billing/resolveCheckoutDisplayAmount";

describe("resolveCheckoutDisplayAmountBrl", () => {
    it("uses checkout_amount_brl from API when set", () => {
        assert.equal(
            resolveCheckoutDisplayAmountBrl({
                planKey: "pro",
                billingPeriod: "year",
                checkoutAmountBrl: 1675.2,
                monthlyPricesBrl: { pro: 349 },
                yearlyPricesBrl: { pro: 1675.2 },
            }),
            1675.2
        );
    });

    it("uses yearly catalog when billing_period is year and no pending invoice", () => {
        assert.equal(
            resolveCheckoutDisplayAmountBrl({
                planKey: "pro",
                billingPeriod: "year",
                monthlyPricesBrl: { pro: 349 },
                yearlyPricesBrl: { pro: 1675.2 },
            }),
            1675.2
        );
    });

    it("does not fall back to monthly when annual cycle", () => {
        const v = resolveCheckoutDisplayAmountBrl({
            planKey: "pro",
            billingPeriod: "year",
            monthlyPricesBrl: { pro: 349 },
            yearlyPricesBrl: { pro: 1675.2 },
        });
        assert.notEqual(v, 349);
    });
});
