import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    mergeExtractedWithLexicalFallback,
    seedWorklistFromExtract,
} from "../../src/pro/pipeline/orderWorklist/seedWorklistFromExtract";
import { extractCandidatePendingTermsFromUserText } from "../../src/pro/domain/orderWorklist/extractCandidateTerms";
import type { OrderLinesExtractPort } from "../../src/pro/ports/orderLinesExtract.port";

describe("mergeExtractedWithLexicalFallback", () => {
    it("completa extract parcial com lexical", () => {
        const merged = mergeExtractedWithLexicalFallback(
            [{ rawTerm: "whisk", quantity: 1 }],
            [
                { rawTerm: "skol", quantity: null },
                { rawTerm: "caixa de jamel", quantity: null },
                { rawTerm: "whisk", quantity: null },
            ]
        );
        assert.equal(merged.length, 3);
        assert.ok(merged.some((l) => /skol/i.test(l.rawTerm)));
        assert.ok(merged.some((l) => /jamel/i.test(l.rawTerm)));
    });

    it("extract vazio → usa fallback", () => {
        const merged = mergeExtractedWithLexicalFallback([], [{ rawTerm: "a" }, { rawTerm: "b" }]);
        assert.deepEqual(
            merged.map((l) => l.rawTerm),
            ["a", "b"]
        );
    });
});

describe("seedWorklistFromExtract — partial LLM + lexical", () => {
    it("sela 3 lines quando LLM devolve só whisk e lexical acha skol/jamel/whisk", async () => {
        const userText = "Quero duas skol tres caixa de jamel e um whisk";
        const extractPort: OrderLinesExtractPort = {
            async extract() {
                return { lines: [{ rawTerm: "whisk", quantity: 1 }] };
            },
        };
        const wl = await seedWorklistFromExtract({
            previous: null,
            userText,
            extractPort,
            fallbackExtracted: extractCandidatePendingTermsFromUserText(userText).map((rawTerm) => ({
                rawTerm,
            })),
        });
        const terms = wl.lines.map((l) => l.rawTerm.toLowerCase());
        assert.ok(terms.some((t) => t.includes("skol")), JSON.stringify(terms));
        assert.ok(terms.some((t) => t.includes("jamel")), JSON.stringify(terms));
        assert.ok(terms.some((t) => t.includes("whisk")), JSON.stringify(terms));
        assert.ok(wl.lines.length >= 3);
    });
});
