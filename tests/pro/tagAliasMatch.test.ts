import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    explicitCommercialSiglaFromText,
    explicitCommercialSiglaNearQuery,
    preferRowsMatchingTagAliases,
    promoteTagHitsToRequestedSiglaSiblings,
    queryAliasTokens,
    rowTagTokens,
} from "../../src/pro/tools/tagAliasMatch";

describe("tagAliasMatch", () => {
    it("queryAliasTokens stem caixinhas → caixinha", () => {
        const toks = queryAliasTokens("quero 5 caixinhas de original");
        assert.ok(toks.includes("caixinha"));
        assert.ok(toks.includes("original"));
        assert.ok(!toks.includes("quero"));
    });

    it("explicitCommercialSiglaFromText: caixa/unidade, não caixinha", () => {
        assert.equal(explicitCommercialSiglaFromText("quero uma caixa de buchudinha"), "CX");
        assert.equal(explicitCommercialSiglaFromText("duas unidades de buchudinha"), "UN");
        assert.equal(explicitCommercialSiglaFromText("me manda uma caixinha"), null);
        assert.equal(explicitCommercialSiglaFromText("quero fardinho"), null);
    });

    it("explicitCommercialSiglaNearQuery: multi-item não herda caixa do outro produto", () => {
        assert.equal(
            explicitCommercialSiglaNearQuery(
                "heineken",
                "quero duas caixas de buchudinha e 3 heineken"
            ),
            null
        );
        assert.equal(
            explicitCommercialSiglaNearQuery(
                "buchudinha",
                "quero duas caixas de buchudinha e 3 heineken"
            ),
            "CX"
        );
    });

    it("rowTagTokens split vírgula", () => {
        assert.deepEqual(rowTagTokens("caixinha, fardinho", null).sort(), [
            "caixinha",
            "fardinho",
        ]);
    });

    it("caixinha + original → só ORIGINAL LATA CX com tag (não skol)", () => {
        const rows = [
            {
                id: "lata-cx",
                product_name: "ORIGINAL",
                display_name: "ORIGINAL LATA (CX c/15)",
                tags: "caixinha, fardinho",
                sigla_comercial: "CX",
            },
            {
                id: "skol-cx",
                product_name: "SKOL",
                display_name: "SKOL LATA (CX c/12)",
                tags: "caixinha",
                sigla_comercial: "CX",
            },
            {
                id: "lata-un",
                product_name: "ORIGINAL",
                tags: null,
                sigla_comercial: "UN",
            },
        ];
        const out = preferRowsMatchingTagAliases(
            rows,
            "original",
            "quero 5 caixinha de original"
        );
        assert.deepEqual(
            out.map((r) => r.id),
            ["lata-cx"]
        );
    });

    it("só caixinha sem marca → todas com tag caixinha (clarificar upstream)", () => {
        const rows = [
            {
                id: "lata-cx",
                product_name: "ORIGINAL",
                tags: "caixinha, fardinho",
                sigla_comercial: "CX",
            },
            {
                id: "skol-cx",
                product_name: "SKOL",
                tags: "caixinha",
                sigla_comercial: "CX",
            },
            { id: "other", product_name: "HEINEKEN", tags: null, sigla_comercial: "CX" },
        ];
        const out = preferRowsMatchingTagAliases(rows, "caixinha", "me manda uma caixinha");
        assert.deepEqual(
            out.map((r) => r.id).sort(),
            ["lata-cx", "skol-cx"]
        );
    });

    it("buchudinha só na UN + caixa falada → promove CX irmã (mesmo volume)", () => {
        const volume = "vol-trezentinha";
        const rows = [
            {
                id: "buch-un",
                product_name: "ORIGINAL",
                descricao: "TREZENTINHA",
                tags: "buchudinha, trezentinha",
                sigla_comercial: "UN",
                product_volume_id: volume,
                produto_id: "p-orig",
                preco_venda: 5,
            },
            {
                id: "buch-cx",
                product_name: "ORIGINAL",
                descricao: "TREZENTINHA",
                tags: null,
                sigla_comercial: "CX",
                product_volume_id: volume,
                produto_id: "p-orig",
                preco_venda: 90,
            },
            {
                id: "other-cx",
                product_name: "ORIGINAL",
                descricao: "LATA",
                tags: null,
                sigla_comercial: "CX",
                product_volume_id: "vol-lata",
                produto_id: "p-orig",
                preco_venda: 60,
            },
        ];
        const out = preferRowsMatchingTagAliases(
            rows,
            "buchudinha",
            "Quero duas caixas de buchudinha"
        );
        assert.deepEqual(
            out.map((r) => r.id),
            ["buch-cx"]
        );
    });

    it("promoteTagHitsToRequestedSiglaSiblings: tag UN → CX do mesmo volume", () => {
        const volume = "v1";
        const pool = [
            {
                id: "un",
                tags: "buchudinha",
                sigla_comercial: "UN",
                product_volume_id: volume,
                produto_id: "p1",
            },
            {
                id: "cx",
                tags: null,
                sigla_comercial: "CX",
                product_volume_id: volume,
                produto_id: "p1",
            },
        ];
        const out = promoteTagHitsToRequestedSiglaSiblings(pool, [pool[0]!], "CX");
        assert.deepEqual(
            out.map((r) => r.id),
            ["cx"]
        );
    });

    it("buchudinha sem sigla → UN e CX se ambos tiverem tag; senão só tag hits", () => {
        const rows = [
            {
                id: "buch-un",
                product_name: "ORIGINAL",
                tags: "buchudinha",
                sigla_comercial: "UN",
            },
            {
                id: "buch-cx",
                product_name: "ORIGINAL",
                tags: "buchudinha",
                sigla_comercial: "CX",
            },
        ];
        const out = preferRowsMatchingTagAliases(rows, "buchudinha", "quero buchudinha");
        assert.deepEqual(
            out.map((r) => r.id).sort(),
            ["buch-cx", "buch-un"]
        );
    });
});
