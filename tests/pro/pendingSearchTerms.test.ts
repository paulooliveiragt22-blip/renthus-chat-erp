import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    extractCandidatePendingTermsFromUserText,
    pendingTermsReferToSame,
} from "../../src/pro/domain/orderWorklist/extractCandidateTerms";

describe("extractCandidateTerms (lexical fallback)", () => {
    it("extract: multi-item com 'e' / vírgula", () => {
        assert.deepEqual(
            extractCandidatePendingTermsFromUserText("quero whisky e vodka e gin").map((t) =>
                t.toLowerCase()
            ),
            ["whisky", "vodka", "gin"]
        );
        assert.deepEqual(
            extractCandidatePendingTermsFromUserText("skol, original").map((t) => t.toLowerCase()),
            ["skol", "original"]
        );
    });

    it("extract: qty justapostas (smoke Ferrester sem 'e')", () => {
        const terms = extractCandidatePendingTermsFromUserText(
            "Quero duas skol tres caixa de jamel e um whisk"
        ).map((t) => t.toLowerCase());
        assert.ok(terms.includes("skol"), `esperava skol, got ${JSON.stringify(terms)}`);
        assert.ok(
            terms.some((t) => t.includes("jamel")),
            `esperava jamel, got ${JSON.stringify(terms)}`
        );
        assert.ok(terms.includes("whisk") || terms.includes("whisky"), `esperava whisk, got ${JSON.stringify(terms)}`);
        assert.ok(terms.length >= 3);
    });

    it("extract: single product → [] (não semeia)", () => {
        assert.deepEqual(extractCandidatePendingTermsFromUserText("quero uma skol"), []);
        assert.deepEqual(extractCandidatePendingTermsFromUserText("oi"), []);
    });

    it("extract: ignora só embalagem / fulfillment (fica <2 → sem seed)", () => {
        assert.deepEqual(extractCandidatePendingTermsFromUserText("quero skol e uma caixa"), []);
        assert.deepEqual(extractCandidatePendingTermsFromUserText("quero skol e entrega"), []);
    });

    it("pendingTermsReferToSame: substring e igualdade", () => {
        assert.equal(pendingTermsReferToSame("skol", "Skol"), true);
        assert.equal(pendingTermsReferToSame("original", "cerveja original"), true);
        assert.equal(pendingTermsReferToSame("skol", "heineken"), false);
    });
});
