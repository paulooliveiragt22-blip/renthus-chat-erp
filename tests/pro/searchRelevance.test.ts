import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    applySearchRelevanceRerank,
    extractSearchQueryHints,
} from "../../lib/chatbot/pro/searchRelevance";
import type { ChatProdutoRow } from "../../lib/chatbot/pro/searchProdutos";

function row(partial: Partial<ChatProdutoRow> & Pick<ChatProdutoRow, "id" | "product_name">): ChatProdutoRow {
    return {
        descricao: null,
        sigla_comercial: "UN",
        preco_venda: 10,
        volume_quantidade: 330,
        unit_type_sigla: "ml",
        fator_conversao: 1,
        product_volume_id: null,
        category_id: null,
        score: 0.5,
        ...partial,
    };
}

describe("extractSearchQueryHints", () => {
    it("detecta long neck + caixa", () => {
        const h = extractSearchQueryHints("quero uma Heineken long neck caixa");
        assert.ok(h.descriptors.includes("long neck") || h.descriptors.includes("longneck"));
        assert.equal(h.packaging, "CX");
        assert.ok(h.brandishTokens.includes("heineken"));
    });
});

describe("applySearchRelevanceRerank", () => {
    it("prioriza long neck CX e remove 600ml sem long neck", () => {
        const rows = [
            row({
                id: "600",
                product_name: "HEINEKEN 600ml",
                display_name: "HEINEKEN 600ml (CX c/24)",
                sigla_comercial: "CX",
                volume_quantidade: 600,
                fator_conversao: 24,
                score: 0.7,
            }),
            row({
                id: "ln-un",
                product_name: "HEINEKEN LONG NECK",
                display_name: "HEINEKEN LONG NECK",
                sigla_comercial: "UN",
                volume_quantidade: 330,
                fator_conversao: 1,
                score: 0.55,
            }),
            row({
                id: "ln-cx",
                product_name: "HEINEKEN LONG NECK",
                display_name: "HEINEKEN LONG NECK (CX c/6)",
                descricao: "CX c/6",
                sigla_comercial: "CX",
                volume_quantidade: 330,
                fator_conversao: 6,
                score: 0.52,
            }),
        ];
        const out = applySearchRelevanceRerank("Heineken long neck caixa", rows);
        assert.ok(out.length >= 1);
        assert.equal(out[0]?.id, "ln-cx");
        assert.ok(!out.some((r) => r.id === "600"));
        assert.ok(out.some((r) => r.id === "ln-un" || r.id === "ln-cx"));
    });
});
