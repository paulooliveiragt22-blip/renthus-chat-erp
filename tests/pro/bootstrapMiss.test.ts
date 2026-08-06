import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scoreDidYouMean } from "../../src/pro/tools/searchNormalize";
import {
    formatAskRepeatProductBody,
    formatNearMissClarificationBody,
} from "../../src/pro/pipeline/orderDraftPresenter";

describe("scoreDidYouMean typos", () => {
    it("haineken ≈ heineken", () => {
        assert.ok(scoreDidYouMean("haineken", "HEINEKEN LONG NECK") >= 0.5);
    });
    it("longnek ≈ longneck", () => {
        assert.ok(scoreDidYouMean("longnek", "HEINEKEN LONG NECK") >= 0.5);
    });
});

describe("miss / near-miss copy", () => {
    it("pede para repetir com item já anotado", () => {
        const t = formatAskRepeatProductBody("fandangos", {
            keptItemsHint: "Já anotei: 2x HEINEKEN LONG NECK.",
        });
        assert.match(t, /Já anotei/);
        assert.match(t, /fandangos/i);
        assert.match(t, /repetir/i);
    });

    it("near-miss lista opções", () => {
        const t = formatNearMissClarificationBody("fandago", [
            { label: "SALGADINHO", price: 15 },
        ]);
        assert.match(t, /Não achei/i);
        assert.match(t, /SALGADINHO/);
    });
});
