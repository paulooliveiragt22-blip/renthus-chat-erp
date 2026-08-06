import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toChatCatalogPublicItem } from "../../src/pro/tools/catalogPublicDto";
import {
    canServerPrepareFromCatalogQtyOffer,
    isAdditiveCatalogQtyOffer,
    resolveSingleOfferedEmbalagemId,
} from "../../src/pro/pipeline/serverPrepareFromCatalogQtyOffer";
import type { ProSessionState } from "../../src/types/contracts";

describe("toChatCatalogPublicItem", () => {
    it("não vaza custo, estoque, códigos nem ids internos", () => {
        const pub = toChatCatalogPublicItem({
            id: "11111111-1111-1111-1111-111111111111",
            product_name: "X-BURGER",
            display_name: "X-BURGER LATA",
            descricao: "LATA",
            detalhes: "carne, tomate, alface",
            informacoes: "grelhado na brasa",
            preco_venda: 15,
            preco_custo: 7.5,
            estoque_unidades: 99,
            codigo_interno: "INT-1",
            codigo_barras_ean: "789",
            produto_id: "22222222-2222-2222-2222-222222222222",
            product_volume_id: "33333333-3333-3333-3333-333333333333",
            category_id: "44444444-4444-4444-4444-444444444444",
            company_id: "55555555-5555-5555-5555-555555555555",
            sigla_comercial: "UN",
            volume_quantidade: 350,
            unit_type_sigla: "ml",
            fator_conversao: 1,
            tags: "burger",
            vender_com_estoque_zero: true,
            thumbnail_url: "https://x/y.png",
            score: 0.9,
        });
        assert.equal(pub.descricao_ingredientes, "carne, tomate, alface");
        assert.equal(pub.informacoes, "grelhado na brasa");
        assert.equal(pub.preco_venda, 15);
        assert.equal(pub.disponivel, true);
        assert.equal(
            /preco_custo|estoque|INT-1|789|thumbnail|score|produto_id|company_id/i.test(
                JSON.stringify(pub)
            ),
            false
        );
    });
});

describe("resolveSingleOfferedEmbalagemId", () => {
    const base = {
        searchProdutoEmbalagemIds: [] as string[],
        lastSearchPicks: [] as ProSessionState["lastSearchPicks"],
        draft: null,
    } as unknown as ProSessionState;

    it("usa pick único", () => {
        assert.equal(
            resolveSingleOfferedEmbalagemId({
                ...base,
                lastSearchPicks: [{ embalagemId: "aaa", label: "Coca" }],
            }),
            "aaa"
        );
    });
    it("não resolve com clarificação ≥2", () => {
        assert.equal(
            resolveSingleOfferedEmbalagemId({
                ...base,
                lastSearchPicks: [
                    { embalagemId: "a", label: "UN" },
                    { embalagemId: "b", label: "CX" },
                ],
            }),
            null
        );
    });
    it("permite prepare com draft existente (additive)", () => {
        assert.equal(
            canServerPrepareFromCatalogQtyOffer({
                ...base,
                lastSearchPicks: [{ embalagemId: "aaa", label: "Coca" }],
                draft: { items: [{ produtoEmbalagemId: "aaa", quantity: 3 }] } as ProSessionState["draft"],
            }),
            true
        );
        assert.equal(
            isAdditiveCatalogQtyOffer({
                ...base,
                draft: { items: [{ produtoEmbalagemId: "aaa", quantity: 3 }] } as ProSessionState["draft"],
            }),
            true
        );
    });
});
