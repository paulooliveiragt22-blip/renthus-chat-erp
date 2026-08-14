import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPackDisplayName } from "../../lib/products/packDisplayName";
import {
    filterPublicMenuItems,
    scorePublicMenuItem,
} from "../../lib/public-menu/searchMenuItems";
import type { PublicMenuItem } from "../../src/types/contracts.public-menu";

function item(partial: Partial<PublicMenuItem> & Pick<PublicMenuItem, "name">): PublicMenuItem {
    return {
        embalagemId: partial.embalagemId ?? "e1",
        productId: partial.productId ?? "p1",
        categoryId: partial.categoryId ?? "c1",
        categoryName: partial.categoryName ?? "Cervejas",
        name: partial.name,
        description: partial.description ?? null,
        price: partial.price ?? 8,
        currency: "BRL",
        sigla: partial.sigla ?? "UN",
        fatorConversao: partial.fatorConversao ?? 1,
        thumbnailUrl: null,
        imageUrl: null,
        inStock: true,
    };
}

describe("searchMenuItems", () => {
    it("query vazia devolve todos", () => {
        const items = [item({ name: "Heineken Long Neck" })];
        assert.equal(filterPublicMenuItems(items, "  ").length, 1);
        assert.equal(filterPublicMenuItems(items, "a").length, 1);
    });

    it("typo heinekin encontra Heineken", () => {
        const heineken = item({
            name: buildPackDisplayName({
                productName: "Heineken",
                itemName: "Long Neck",
                volumeQuantidade: 330,
                unitSigla: "ml",
            }),
        });
        const brahma = item({
            embalagemId: "e2",
            productId: "p2",
            name: buildPackDisplayName({ productName: "Brahma", itemName: "Lata" }),
        });
        const hits = filterPublicMenuItems([heineken, brahma], "heinekin");
        assert.equal(hits.length, 1);
        assert.equal(hits[0]?.name, heineken.name);
        assert.ok(scorePublicMenuItem("heinekin", heineken) >= 0.55);
    });

    it("brahma lata casa o nome montado (produto + item)", () => {
        const named = item({
            name: buildPackDisplayName({
                productName: "Brahma",
                itemName: "Lata",
                volumeQuantidade: 350,
                unitSigla: "ml",
            }),
        });
        assert.equal(named.name, "Brahma Lata");
        const hits = filterPublicMenuItems([named], "brahma lata");
        assert.equal(hits.length, 1);
        assert.equal(hits[0]?.name, "Brahma Lata");
    });

    it("acento e plural não bloqueiam", () => {
        const burger = item({
            name: buildPackDisplayName({
                productName: "Hambúrguer Artesanal",
                itemName: "Smash",
            }),
            categoryName: "Lanches",
        });
        const hits = filterPublicMenuItems([burger], "hamburgueres");
        assert.equal(hits.length, 1);
    });

    it("não devolve item sem relação", () => {
        const agua = item({ name: "Água Mineral 500ml" });
        assert.equal(filterPublicMenuItems([agua], "heineken").length, 0);
    });
});
