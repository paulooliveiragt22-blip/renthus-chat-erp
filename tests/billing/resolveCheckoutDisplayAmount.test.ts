import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    resolveCheckoutDisplayAmountBrl,
    resolveOfficeCheckoutAmountBrl,
} from "../../lib/billing/resolveCheckoutDisplayAmount";

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

describe("resolveOfficeCheckoutAmountBrl", () => {
    it("prefere o valor da obrigação", () => {
        assert.equal(
            resolveOfficeCheckoutAmountBrl({
                billingPeriod: "month",
                checkoutAmountBrl: 1198.8,
            }),
            1198.8
        );
    });

    it("cai no anual do Office quando não há cobrança", () => {
        assert.equal(
            resolveOfficeCheckoutAmountBrl({ billingPeriod: "year" }),
            1198.8
        );
    });

    it("cai no mensal do Office quando o ciclo é mês", () => {
        assert.equal(
            resolveOfficeCheckoutAmountBrl({ billingPeriod: "month" }),
            159
        );
    });
});
