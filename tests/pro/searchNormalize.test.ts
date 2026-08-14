import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandSearchVariants, normalizeSearchKey, scoreDidYouMean } from "../../lib/products/searchNormalize";

describe("searchNormalize", () => {
    it("remove acentos", () => {
        assert.equal(normalizeSearchKey("Hambúrguer"), "hamburguer");
    });

    it("hamburgueres gera stem hamburguer", () => {
        const v = expandSearchVariants("hamburgueres");
        assert.ok(v.includes("hamburgueres"));
        assert.ok(v.includes("hamburguer"));
    });

    it("score alto quando candidate contém stem", () => {
        const s = scoreDidYouMean("hamburgueres", "Hambúrguer Artesanal");
        assert.ok(s >= 0.5);
    });

    it("typo heinekin aproxima Heineken", () => {
        const s = scoreDidYouMean("heinekin", "Heineken Long Neck");
        assert.ok(s >= 0.55);
    });
});
