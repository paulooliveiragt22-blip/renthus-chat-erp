import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { expandSearchVariants, normalizeSearchKey, scoreDidYouMean } from "../../src/pro/tools/searchNormalize";

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
});
