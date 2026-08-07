import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrichSearchTermPackagingFromUserText } from "../../src/pro/pipeline/packagingHint";
import { buildBootstrapSegmentPlanFromExtraction } from "../../src/pro/replay/bootstrapSegmentPlan";

describe("enrichSearchTermPackagingFromUserText", () => {
    it("reinsere caixa quando LLM omitiu", () => {
        const t = enrichSearchTermPackagingFromUserText(
            "skol lata",
            "me ve uma caixa de skol lata e duas coca 2 litros"
        );
        assert.equal(t, "skol lata caixa");
    });

    it("não mexe se já tem caixa", () => {
        const t = enrichSearchTermPackagingFromUserText(
            "skol lata caixa",
            "me ve uma caixa de skol lata"
        );
        assert.equal(t, "skol lata caixa");
    });

    it("não propaga caixa de outro item", () => {
        const t = enrichSearchTermPackagingFromUserText(
            "coca 2 litros",
            "me ve uma caixa de skol lata e duas coca 2 litros"
        );
        assert.equal(t, "coca 2 litros");
    });
});

describe("buildBootstrapSegmentPlanFromExtraction + userText", () => {
    it("enriquece segmento com caixa do texto cru", () => {
        const plan = buildBootstrapSegmentPlanFromExtraction(
            {
                v: 1,
                items: [
                    { searchTerm: "skol lata", quantity: 1 },
                    { searchTerm: "coca 2 litros", quantity: 2 },
                ],
            },
            "me ve uma caixa de skol lata e duas coca 2 litros"
        );
        assert.ok(plan);
        assert.ok(plan!.segments.some((s) => /caixa/i.test(s) && /skol/i.test(s)));
        assert.ok(plan!.segments.some((s) => /coca/i.test(s) && !/caixa/i.test(s)));
    });
});
