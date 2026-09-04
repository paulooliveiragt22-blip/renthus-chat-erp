import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    applyPromoAdjustmentCents,
    computeMonthlyChargeCents,
    prorateSeatExtraCents,
} from "@/lib/billing/subscriptionAmount";

describe("subscriptionAmount", () => {
    const pro = {
        monthlyPriceCents: 34900,
        yearlyPriceCents: 335040,
        includedSeats: 1,
        seatExtraCents: 9900,
    };

    it("mensal sem seats extras = lista", () => {
        assert.equal(computeMonthlyChargeCents(pro, 1), 34900);
    });

    it("Pro 3 users = 349 + 2×99", () => {
        assert.equal(computeMonthlyChargeCents(pro, 3), 34900 + 2 * 9900);
    });

    it("Essencial ignora extras no amount (cap sem seat)", () => {
        assert.equal(
            computeMonthlyChargeCents(
                {
                    monthlyPriceCents: 27900,
                    yearlyPriceCents: 267840,
                    includedSeats: 1,
                    seatExtraCents: null,
                },
                3
            ),
            27900
        );
    });

    it("promo percent 50% discount", () => {
        assert.equal(
            applyPromoAdjustmentCents(27900, {
                adjustment_kind: "discount",
                adjustment_mode: "percent",
                adjustment_value: 5000,
            }),
            13950
        );
    });

    it("proration seat parcial", () => {
        const now = new Date("2026-09-04T12:00:00Z");
        const next = new Date("2026-09-19T12:00:00Z"); // 15 days
        const cents = prorateSeatExtraCents(9900, next, now, 30);
        assert.equal(cents, Math.round((9900 * 15) / 30));
    });
});
