import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    catalogOfferListKind,
    formatCatalogOfferList,
} from "../../src/pro/tools/catalogOfferList";

describe("catalogOfferListKind", () => {
    it("reconhece pergunta de promoção e de combo", () => {
        assert.equal(catalogOfferListKind("o que está em promoção?"), "promos");
        assert.equal(catalogOfferListKind("tem promoção"), "promos");
        assert.equal(catalogOfferListKind("quais combos vocês têm"), "combos");
        assert.equal(catalogOfferListKind("combos"), "combos");
    });

    it("não trata nome de produto como vitrine", () => {
        assert.equal(catalogOfferListKind("combo master"), null);
        assert.equal(catalogOfferListKind("promoção da heineken"), null);
        assert.equal(catalogOfferListKind("quero o combo de sexta"), null);
        assert.equal(catalogOfferListKind("heineken"), null);
    });
});

describe("formatCatalogOfferList", () => {
    it("lista só o preço da promoção, com a composição do combo", () => {
        const text = formatCatalogOfferList("promos", [
            { name: "HEINEKEN LATA", price: 40 },
            { name: "Combo sexta", price: 50, composition: "1× SKOL · 1× HAMBURGUER" },
        ]);
        assert.match(text, /HEINEKEN LATA — por R\$ 40,00/);
        assert.match(text, /Combo sexta — por R\$ 50,00/);
        assert.match(text, /1× SKOL · 1× HAMBURGUER/);
        assert.equal(/de\s*R\$/i.test(text), false);
        assert.equal(text.includes("de:"), false);
    });

    it("diz quando não há promoção", () => {
        const text = formatCatalogOfferList("promos", []);
        assert.match(text, /não temos promoção ativa/);
        assert.equal(text.includes("por R$"), false);
    });
});
