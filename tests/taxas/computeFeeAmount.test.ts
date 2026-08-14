import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeFeeAmount } from "../../src/taxas/domain/types";

describe("computeFeeAmount", () => {
    it("fixed returns rounded reais", () => {
        assert.equal(computeFeeAmount("fixed", 5.555, 100), 5.56);
    });

    it("percent on item subtotal", () => {
        assert.equal(computeFeeAmount("percent", 10, 80), 8);
    });

    it("clamps negative rate", () => {
        assert.equal(computeFeeAmount("fixed", -3, 50), 0);
    });
});
