import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractQuantityNearQuery } from "../../src/pro/tools/parseQtyPt";

describe("extractQuantityNearQuery — multi-item", () => {
    const msg = "Quero duas skol tres caixa de jamel e um whisk";

    it("whisky/whisk → 1 (não herda 'duas' da skol)", () => {
        assert.equal(extractQuantityNearQuery("whisky", msg), 1);
        assert.equal(extractQuantityNearQuery("whisk", msg), 1);
    });

    it("skol → 2", () => {
        assert.equal(extractQuantityNearQuery("skol", msg), 2);
    });

    it("jamel → 3", () => {
        assert.equal(extractQuantityNearQuery("jamel", msg), 3);
        assert.equal(extractQuantityNearQuery("caixa de jamel", msg), 3);
    });
});
