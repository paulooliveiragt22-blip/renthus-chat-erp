import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAN_CATALOG, defaultYearlyCentsFromMonthly } from "@/lib/billing/planCatalog";

describe("PLAN_CATALOG BN-04", () => {
    it("mensal 279 / 349 / 449 e IA 10%", () => {
        assert.equal(PLAN_CATALOG.essencial.monthlyPriceCents, 27900);
        assert.equal(PLAN_CATALOG.pro.monthlyPriceCents, 34900);
        assert.equal(PLAN_CATALOG.market.monthlyPriceCents, 44900);
        assert.equal(PLAN_CATALOG.essencial.aiIncludedCents, 2790);
        assert.equal(PLAN_CATALOG.pro.aiIncludedCents, 3490);
        assert.equal(PLAN_CATALOG.market.aiIncludedCents, 4490);
    });

    it("anual default −20% e seats R2-C", () => {
        assert.equal(
            PLAN_CATALOG.essencial.yearlyPriceCents,
            defaultYearlyCentsFromMonthly(27900)
        );
        assert.equal(PLAN_CATALOG.essencial.includedSeats, 1);
        assert.equal(PLAN_CATALOG.essencial.seatExtraCents, null);
        assert.equal(PLAN_CATALOG.pro.includedSeats, 1);
        assert.equal(PLAN_CATALOG.pro.seatExtraCents, 9900);
        assert.equal(PLAN_CATALOG.market.includedSeats, 10);
        assert.equal(PLAN_CATALOG.market.seatExtraCents, 9900);
        assert.ok(PLAN_CATALOG.market.features.includes("table_service"));
        assert.ok(!PLAN_CATALOG.market.features.includes("mobile_app"));
    });
});
