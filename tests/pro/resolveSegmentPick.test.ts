import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSegmentPick } from "../../src/pro/pipeline/resolveSegmentPick";

const heinekenHits = [
    {
        id: "cx6",
        display_name: "HEINEKEN LONGNECK (CX c/6)",
        product_name: "HEINEKEN",
        sigla_comercial: "CX",
        preco_venda: 60,
    },
    {
        id: "cx24",
        display_name: "HEINEKEN 600ml (CX c/24)",
        product_name: "HEINEKEN",
        sigla_comercial: "CX",
        preco_venda: 336,
    },
    {
        id: "un",
        display_name: "HEINEKEN LONG NECK",
        product_name: "HEINEKEN",
        sigla_comercial: "UN",
        preco_venda: 10,
    },
    {
        id: "lata",
        display_name: "HEINEKEN LATA (CX c/8)",
        product_name: "HEINEKEN",
        sigla_comercial: "CX",
        preco_venda: 48,
    },
];

describe("resolveSegmentPick", () => {
    it("heineken long neck caixa → CX c/6 unívoco", () => {
        const r = resolveSegmentPick("heineken long neck caixa", heinekenHits);
        assert.equal(r.kind, "unique");
        if (r.kind === "unique") assert.equal(r.pick.embalagemId, "cx6");
    });

    it("hamburguer rosseiro → prioriza rosseiro", () => {
        const r = resolveSegmentPick("hamburguer rosseiro", [
            {
                id: "lenhador",
                display_name: "HAMBURGUER LENHADOR",
                product_name: "HAMBURGUER",
                sigla_comercial: "UN",
                preco_venda: 35,
            },
            {
                id: "rosseiro",
                display_name: "HABURGUER ROSSEIRO BURGER X",
                product_name: "HABURGUER ROSSEIRO",
                sigla_comercial: "UN",
                preco_venda: 25,
            },
        ]);
        assert.equal(r.kind, "unique");
        if (r.kind === "unique") assert.equal(r.pick.embalagemId, "rosseiro");
    });

    it("salgadinho sem embalagem → ambíguo UN/CX", () => {
        const r = resolveSegmentPick("salgadinho", [
            {
                id: "un",
                display_name: "SALGADINHO",
                product_name: "SALGADINHO",
                sigla_comercial: "UN",
                preco_venda: 15,
            },
            {
                id: "cx",
                display_name: "SALGADINHO CX 15UN (CX c/15)",
                product_name: "SALGADINHO",
                sigla_comercial: "CX",
                preco_venda: 220,
            },
        ]);
        assert.equal(r.kind, "ambiguous");
    });
});
