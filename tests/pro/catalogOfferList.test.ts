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
        const reply = formatCatalogOfferList("promos", [
            { id: "emb-1", name: "HEINEKEN LATA", price: 40 },
            { id: "combo-1", name: "Combo sexta", price: 50, composition: "1× SKOL · 1× HAMBURGUER" },
        ]);
        assert.match(reply.text, /HEINEKEN LATA — por R\$ 40,00/);
        assert.match(reply.text, /Combo sexta — por R\$ 50,00/);
        assert.match(reply.text, /1× SKOL · 1× HAMBURGUER/);
        assert.match(reply.text, /digite o número/);
        assert.equal(/de\s*R\$/i.test(reply.text), false);
        assert.equal(reply.text.includes("de:"), false);
        assert.equal(reply.picks.length, 2);
        assert.equal(reply.picks[0]?.embalagemId, "emb-1");
        assert.equal(reply.picks[1]?.embalagemId, "combo-1");
    });

    it("diz quando não há promoção", () => {
        const reply = formatCatalogOfferList("promos", []);
        assert.match(reply.text, /não temos promoção ativa/);
        assert.equal(reply.text.includes("por R$"), false);
        assert.equal(reply.picks.length, 0);
    });
});
