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
});
