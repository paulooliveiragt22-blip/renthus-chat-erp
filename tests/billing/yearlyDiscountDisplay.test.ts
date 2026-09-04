import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    computeYearlyPriceCents,
    yearlyDiscountLabelPercent,
    yearlySavingsPercent,
} from "@/lib/billing/yearlyFromDiscount";
import {
    brlInputToCents,
    centsToBrlInput,
    percentHundredthsToInput,
    percentInputToHundredths,
} from "@/lib/billing/moneyDisplay";

describe("yearlyFromDiscount", () => {
    it("20% off mensal 279 → anual", () => {
        assert.equal(computeYearlyPriceCents(27900, "percent", 2000), Math.round(27900 * 12 * 0.8));
    });

    it("fixed R$ 100 off no anual", () => {
        assert.equal(computeYearlyPriceCents(27900, "fixed_brl", 10000), 27900 * 12 - 10000);
    });

    it("UI anual: price_year_cents/12 é o valor/mês exibido (essencial 267840)", () => {
        const year = computeYearlyPriceCents(27900, "percent", 2000);
        assert.equal(year, 267840);
        assert.equal(Math.round(year / 12), 22320);
    });

    it("toggle: percent canônico 2000 → 20%", () => {
        const year = computeYearlyPriceCents(27900, "percent", 2000);
        assert.equal(yearlyDiscountLabelPercent("percent", 2000, 27900, year), 20);
        assert.equal(yearlySavingsPercent(27900, year), 20);
    });

    it("toggle: percent canônico 1500 → 15%", () => {
        const year = computeYearlyPriceCents(34900, "percent", 1500);
        assert.equal(yearlyDiscountLabelPercent("percent", 1500, 34900, year), 15);
    });
});

describe("moneyDisplay PT-BR", () => {
    it("centavos ↔ R$", () => {
        assert.equal(centsToBrlInput(27900), "279,00");
        assert.equal(brlInputToCents("279,00"), 27900);
        assert.equal(brlInputToCents("R$ 1.349,90"), 134990);
    });

    it("% centésimos", () => {
        assert.equal(percentHundredthsToInput(2000), "20,00");
        assert.equal(percentInputToHundredths("50,00"), 5000);
    });
});
