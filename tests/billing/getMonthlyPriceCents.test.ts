import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    getMonthlyPriceCentsForPlan,
    getYearlyPriceCentsForPlan,
    PLAN_CATALOG,
} from "@/lib/billing/planCatalog";

describe("preços canônicos BN-04/05 (sem pagarme server-only)", () => {
    it("mensal do catálogo + aliases", () => {
        assert.equal(getMonthlyPriceCentsForPlan("essencial"), 27900);
        assert.equal(getMonthlyPriceCentsForPlan("pro"), 34900);
        assert.equal(getMonthlyPriceCentsForPlan("market"), 44900);
        assert.equal(getMonthlyPriceCentsForPlan("bot"), 27900);
        assert.equal(getMonthlyPriceCentsForPlan("complete"), 34900);
    });

    it("anual −20% default (BN-04); setup abolido (BN-05)", () => {
        assert.equal(getYearlyPriceCentsForPlan("essencial"), 267840);
        assert.equal(getYearlyPriceCentsForPlan("pro"), 335040);
        assert.equal(getYearlyPriceCentsForPlan("market"), 431040);
        assert.equal(PLAN_CATALOG.pro.seatExtraCents, 9900);
    });
});
