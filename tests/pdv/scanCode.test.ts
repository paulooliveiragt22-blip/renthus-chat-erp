import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeScanCode, normalizeScanDigits } from "../../lib/pdv/scanCode";

describe("pdv scanCode", () => {
    it("reconhece EAN/numérico e código interno", () => {
        assert.equal(looksLikeScanCode("7891234567890"), true);
        assert.equal(looksLikeScanCode("1234"), true);
        assert.equal(looksLikeScanCode("SKOL-01"), true);
        assert.equal(looksLikeScanCode("AB12"), true);
    });

    it("rejeita busca textual", () => {
        assert.equal(looksLikeScanCode("skol lata"), false);
        assert.equal(looksLikeScanCode("ab"), false);
        assert.equal(looksLikeScanCode("SKU"), false); // sem dígito
    });

    it("normalizeScanDigits remove máscara", () => {
        assert.equal(normalizeScanDigits("789.1234.567890"), "7891234567890");
    });
});
