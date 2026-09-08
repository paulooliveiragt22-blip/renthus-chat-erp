import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    extractCandidatePendingTermsFromUserText,
    isLikelyPickOrShortReply,
    pendingTermsReferToSame,
} from "../../src/pro/domain/orderWorklist/extractCandidateTerms";

describe("extractCandidateTerms (lexical fallback)", () => {
    it("extract: multi-item com 'e' / vírgula", () => {
        assert.deepEqual(
            extractCandidatePendingTermsFromUserText("quero whisky e vodka e gin").map((t) =>
                t.rawTerm.toLowerCase()
            ),
            ["whisky", "vodka", "gin"]
        );
        assert.deepEqual(
            extractCandidatePendingTermsFromUserText("skol, original").map((t) =>
                t.rawTerm.toLowerCase()
            ),
            ["skol", "original"]
        );
    });

    it("extract: qty justapostas + preserva quantity (smoke Ferrester)", () => {
        const terms = extractCandidatePendingTermsFromUserText(
            "Quero duas skol tres caixa de jamel e um whisk"
        );
        const by = Object.fromEntries(
            terms.map((t) => [t.rawTerm.toLowerCase(), t.quantity])
        );
        assert.equal(by["skol"], 2);
        assert.equal(by["jamel"], 3);
        assert.ok(by["whisk"] === 1 || by["whisky"] === 1, JSON.stringify(by));
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

    it("pendingTermsReferToSame: token (não substring solta multi-item)", () => {
        assert.equal(pendingTermsReferToSame("skol", "Skol"), true);
        assert.equal(pendingTermsReferToSame("original", "cerveja original"), true);
        assert.equal(pendingTermsReferToSame("skol", "heineken"), false);
        assert.equal(pendingTermsReferToSame("skol", "skol tres caixa de jamel"), false);
    });

    it("pendingTermsReferToSame: marmitas m ≠ marmitas g", () => {
        assert.equal(pendingTermsReferToSame("marmitas m", "marmitas g"), false);
        assert.equal(pendingTermsReferToSame("3 marmitas m", "duas marmitas g"), false);
        assert.equal(pendingTermsReferToSame("marmitas m", "marmitas m"), true);
    });

    it("extract: 6 itens com marmitas m + g (smoke cap + size)", () => {
        const text =
            "Quero 3 marmitas m, 2 caixa de skol lata, 2 Heineken longneck, duas Heineken lata, 1 salgadinho e duas marmitas g";
        const terms = extractCandidatePendingTermsFromUserText(text);
        const norms = terms.map((t) => t.rawTerm.toLowerCase());
        assert.ok(terms.length >= 6, JSON.stringify(norms));
        assert.ok(
            norms.some((t) => /marmita/.test(t) && /\bm\b/.test(t)),
            JSON.stringify(norms)
        );
        assert.ok(
            norms.some((t) => /marmita/.test(t) && /\bg\b/.test(t)),
            JSON.stringify(norms)
        );
    });

    it("isLikelyPickOrShortReply: dígito/sigla vs pedido multi-item", () => {
        assert.equal(isLikelyPickOrShortReply("3"), true);
        assert.equal(isLikelyPickOrShortReply("caixa"), true);
        assert.equal(isLikelyPickOrShortReply("2 un"), true);
        assert.equal(
            isLikelyPickOrShortReply("Quero duas skol tres caixa de jamel e um whisk"),
            false
        );
    });
});
