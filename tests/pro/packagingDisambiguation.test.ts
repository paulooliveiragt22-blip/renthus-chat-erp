import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    disambiguatePackagingForSearchRows,
    isSamePackagingFamily,
} from "../../src/pro/pipeline/packagingDisambiguation";

const heinekenRows = [
    {
        id: "cx6",
        display_name: "HEINEKEN LONGNECK (CX c/6)",
        product_name: "HEINEKEN",
        sigla_comercial: "CX",
        fator_conversao: 6,
        preco_venda: 60,
    },
    {
        id: "un",
        display_name: "HEINEKEN LONG NECK",
        product_name: "HEINEKEN",
        sigla_comercial: "UN",
        fator_conversao: 1,
        preco_venda: 10,
    },
];

describe("isSamePackagingFamily", () => {
    it("true quando todas as linhas são do mesmo produto", () => {
        assert.equal(isSamePackagingFamily(heinekenRows), true);
    });

    it("false para produtos diferentes", () => {
        assert.equal(
            isSamePackagingFamily([
                { id: "a", product_name: "HEINEKEN" },
                { id: "b", product_name: "SKOL" },
            ]),
            false
        );
    });

    it("false com menos de 2 linhas", () => {
        assert.equal(isSamePackagingFamily([{ id: "a", product_name: "HEINEKEN" }]), false);
    });
});

describe("disambiguatePackagingForSearchRows", () => {
    it("'quero 2 heineken long neck' sem caixa citada → assume UN (regressão S2)", () => {
        const out = disambiguatePackagingForSearchRows(
            heinekenRows,
            "heineken long neck",
            "quero 2 heineken long neck"
        );
        assert.equal(out.length, 1);
        assert.equal(out[0]!.id, "un");
    });

    it("cliente cita caixa explicitamente → assume CX", () => {
        const out = disambiguatePackagingForSearchRows(
            heinekenRows,
            "heineken long neck",
            "quero uma caixa de heineken long neck"
        );
        assert.equal(out.length, 1);
        assert.equal(out[0]!.id, "cx6");
    });

    it("ambiguidade real (sem heurística aplicável) mantém todas as opções", () => {
        const out = disambiguatePackagingForSearchRows(
            [
                { id: "un", display_name: "SALGADINHO", product_name: "SALGADINHO", sigla_comercial: "UN" },
                { id: "cx", display_name: "SALGADINHO CX 15UN", product_name: "SALGADINHO", sigla_comercial: "CX" },
            ],
            "salgadinho",
            "quero um salgadinho"
        );
        assert.equal(out.length, 2);
    });

    it("produtos diferentes (não é embalagem do mesmo item) não é tocado", () => {
        const rows = [
            { id: "a", product_name: "HEINEKEN", sigla_comercial: "UN" },
            { id: "b", product_name: "SKOL", sigla_comercial: "UN" },
        ];
        const out = disambiguatePackagingForSearchRows(rows, "cerveja", "quero uma cerveja");
        assert.equal(out.length, 2);
    });

    it("'quero 2 skol lata' sem caixa citada → assume UN (regressão: 'lata' também conta, não só long neck)", () => {
        const skolRows = [
            {
                id: "skol-un",
                display_name: "SKOL LATA",
                product_name: "SKOL LATA",
                sigla_comercial: "UN",
                fator_conversao: 1,
                preco_venda: 5,
            },
            {
                id: "skol-cx",
                display_name: "SKOL LATA (CX c/15)",
                product_name: "SKOL LATA",
                sigla_comercial: "CX",
                fator_conversao: 15,
                preco_venda: 60,
            },
        ];
        const out = disambiguatePackagingForSearchRows(skolRows, "skol lata", "quero 2 skol lata");
        assert.equal(out.length, 1);
        assert.equal(out[0]!.id, "skol-un");
    });

    it("hábito do cliente decide quando não há sigla explícita", () => {
        const out = disambiguatePackagingForSearchRows(
            heinekenRows,
            "heineken",
            "quero heineken",
            { habitSigla: "CX" }
        );
        assert.equal(out.length, 1);
        assert.equal(out[0]!.id, "cx6");
    });
});
