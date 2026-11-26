import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    OFFICE_PLAN,
    PLAN_CATALOG,
    defaultYearlyCentsFromMonthly,
    getMonthlyPriceCentsForPlan,
    getYearlyPriceCentsForPlan,
    isOfficePlanKey,
    normalizePlanKey,
    parseSignupPlan,
} from "@/lib/billing/planCatalog";

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

describe("plano Office", () => {
    it("cobra 159 no mês e 1.198,80 no ano, fora do desconto de 20%", () => {
        assert.equal(OFFICE_PLAN.monthlyPriceCents, 15_900);
        assert.equal(OFFICE_PLAN.yearlyPriceCents, 119_880);
        assert.equal(OFFICE_PLAN.yearlyDiscountCents, 70_920);
        assert.equal(OFFICE_PLAN.aiIncludedCents, 1_590);
        assert.equal(OFFICE_PLAN.includedSeats, 1);
        assert.equal(OFFICE_PLAN.seatExtraCents, null);
        assert.notEqual(OFFICE_PLAN.yearlyPriceCents, defaultYearlyCentsFromMonthly(15_900));
        assert.equal(getMonthlyPriceCentsForPlan("office"), 15_900);
        assert.equal(getYearlyPriceCentsForPlan("office"), 119_880);
        assert.equal(normalizePlanKey("office"), null);
        assert.equal(parseSignupPlan("office"), "office");
        assert.equal(isOfficePlanKey(" Office "), true);
        assert.equal((OFFICE_PLAN.features as readonly string[]).includes("pdv"), false);
        assert.equal((OFFICE_PLAN.features as readonly string[]).includes("whatsapp_templates_broadcast"), true);
    });
});
