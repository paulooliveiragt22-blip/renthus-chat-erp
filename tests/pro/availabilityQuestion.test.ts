import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikeAvailabilityOrInfoQuestion } from "../../src/pro/pipeline/availabilityQuestion";

describe("looksLikeAvailabilityOrInfoQuestion", () => {
    it("boa noite tem coca 2l?", () => {
        assert.equal(looksLikeAvailabilityOrInfoQuestion("boa noite tem coca 2l?"), true);
    });
    it("vocês tem skol?", () => {
        assert.equal(looksLikeAvailabilityOrInfoQuestion("vocês tem skol?"), true);
    });
    it("pedido real não é pergunta", () => {
        assert.equal(looksLikeAvailabilityOrInfoQuestion("quero 2 heineken long neck"), false);
    });
    it("quero o que tem de heineken → pedido", () => {
        assert.equal(looksLikeAvailabilityOrInfoQuestion("quero o que tem de heineken"), false);
    });
});
