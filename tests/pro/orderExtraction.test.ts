import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    OrderLineExtractionSchema,
    parseOrderLineExtractionJson,
} from "@/src/domain/contracts/orderExtraction";
import {
    buildBootstrapSegmentPlanFromExtraction,
    swapIntentFromExtraction,
} from "@/src/pro/replay/bootstrapSegmentPlan";
import { summarizeExtractionDivergence } from "@/src/pro/replay/measureExtractionDivergence";
import { looksLikePackagingOnlyHint } from "@/src/pro/pipeline/packagingHint";

describe("order line extraction (LLM only)", () => {
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

    it("parse aceita swap sem items", () => {
        const parsed = parseOrderLineExtractionJson({
            v: 1,
            items: [],
            swap: {
                remove_name: "salgadinho",
                replace_search_term: "salgadinho caixa de 15",
                replace_hint: "caixa de 15",
            },
        });
        assert.ok(parsed);
        assert.equal(parsed!.items.length, 0);
        const swap = swapIntentFromExtraction(parsed);
        assert.ok(swap);
        assert.equal(swap!.removeName, "salgadinho");
        assert.ok(swap!.searchQuery.includes("salgadinho"));
    });

    it("buildBootstrapSegmentPlanFromExtraction usa qty do LLM", () => {
        const plan = buildBootstrapSegmentPlanFromExtraction({
            v: 1,
            items: [{ searchTerm: "heineken", quantity: 2 }],
            paymentMethod: "pix",
        });
        assert.ok(plan);
        assert.equal(plan!.source, "llm");
        assert.equal(plan!.segments[0], "heineken");
        assert.equal(plan!.qtyByTerm.heineken, 2);
        assert.equal(plan!.payment, "pix");
    });

    it("null extraction → sem plano", () => {
        assert.equal(buildBootstrapSegmentPlanFromExtraction(null), null);
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
            {
                text: "troca o salgadinho pela caixa",
                extraction: {
                    v: 1,
                    items: [],
                    swap: {
                        removeName: "salgadinho",
                        replaceSearchTerm: "salgadinho caixa",
                        replaceHint: "caixa",
                    },
                },
            },
        ]);
        assert.equal(summary.cases, 3);
        assert.equal(summary.withExtraction, 3);
        assert.equal(summary.withItems, 2);
        assert.equal(summary.withSwap, 1);
        assert.equal(summary.planReady, 2);
        assert.equal(summary.withPayment, 1);
    });
});

describe("looksLikePackagingOnlyHint", () => {
    it("detecta embalagem sem produto", () => {
        assert.equal(looksLikePackagingOnlyHint("caixa de 15"), true);
        assert.equal(looksLikePackagingOnlyHint("heineken long neck"), false);
    });
});
