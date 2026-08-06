import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    OrderLineExtractionSchema,
    parseOrderLineExtractionJson,
} from "@/src/domain/contracts/orderExtraction";
import {
    diffExtractionVsRegexBootstrap,
    isStructuredExtractShadowEnabled,
} from "@/src/pro/pipeline/shadowStructuredExtract";
import {
    buildBootstrapSegmentPlan,
    isStructuredExtractPrimaryEnabled,
} from "@/src/pro/pipeline/bootstrapSegmentPlan";
import { summarizeExtractionDivergence } from "@/src/pro/replay/measureExtractionDivergence";

describe("order line extraction (Fase 2)", () => {
    it("parseOrderLineExtractionJson aceita snake_case e fence", () => {
        const parsed = parseOrderLineExtractionJson(`\`\`\`json
{"v":1,"items":[{"search_term":"heineken","quantidade":2}],"payment_method":"pix"}
\`\`\``);
        assert.ok(parsed);
        assert.equal(parsed!.items[0]?.searchTerm, "heineken");
        assert.equal(parsed!.items[0]?.quantity, 2);
        assert.equal(parsed!.paymentMethod, "pix");
        assert.equal(OrderLineExtractionSchema.parse(parsed).v, 1);
    });

    it("diffExtractionVsRegexBootstrap marca overlap de termos", () => {
        const text = "quero uma heineken long neck e um salgadinho, pagamento no pix";
        const diff = diffExtractionVsRegexBootstrap(text, {
            v: 1,
            items: [
                { searchTerm: "heineken long neck", quantity: 1 },
                { searchTerm: "salgadinho", quantity: 1 },
            ],
            paymentMethod: "pix",
        });
        assert.ok(diff.regexSegments.length >= 1);
        assert.equal(diff.paymentRegex, "pix");
        assert.equal(diff.paymentLlm, "pix");
    });

    it("flag sombra só liga com 1/true", () => {
        assert.equal(isStructuredExtractShadowEnabled({} as NodeJS.ProcessEnv), false);
        assert.equal(
            isStructuredExtractShadowEnabled({
                PRO_STRUCTURED_EXTRACT_SHADOW: "1",
            } as NodeJS.ProcessEnv),
            true
        );
    });

    it("buildBootstrapSegmentPlan prefere LLM e qty", () => {
        const plan = buildBootstrapSegmentPlan("quero 2 heineken", {
            v: 1,
            items: [{ searchTerm: "heineken", quantity: 2 }],
            paymentMethod: "pix",
        });
        assert.equal(plan.source, "llm");
        assert.equal(plan.segments[0], "heineken");
        assert.equal(plan.qtyByTerm.heineken, 2);
        assert.equal(plan.payment, "pix");
    });

    it("summarizeExtractionDivergence agrega golden offline", () => {
        const summary = summarizeExtractionDivergence([
            {
                text: "quero heineken e salgadinho pix",
                extraction: {
                    v: 1,
                    items: [
                        { searchTerm: "heineken", quantity: 1 },
                        { searchTerm: "salgadinho", quantity: 1 },
                    ],
                    paymentMethod: "pix",
                },
            },
            {
                text: "manda uma coca",
                extraction: {
                    v: 1,
                    items: [{ searchTerm: "coca cola lata", quantity: 1 }],
                },
            },
        ]);
        assert.equal(summary.cases, 2);
        assert.equal(summary.withExtraction, 2);
        assert.equal(summary.llmWouldBecomePrimary, 2);
        assert.ok(summary.equalTerms + summary.divergeTerms === 2);
    });

    it("flag primary", () => {
        assert.equal(isStructuredExtractPrimaryEnabled({} as NodeJS.ProcessEnv), false);
        assert.equal(
            isStructuredExtractPrimaryEnabled({
                PRO_STRUCTURED_EXTRACT_PRIMARY: "1",
            } as NodeJS.ProcessEnv),
            true
        );
    });
});
