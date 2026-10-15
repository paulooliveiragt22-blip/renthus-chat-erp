import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildPackDisplayName,
    formatMenuPackLabel,
    formatPackSiglaLabel,
} from "../../lib/products/packDisplayName";

describe("buildPackDisplayName", () => {
    it("une produto + nome do item sem sigla/fator", () => {
        assert.equal(
            buildPackDisplayName({
                productName: "Heineken",
                itemName: "LATA",
                sigla: "CX",
                fatorConversao: 8,
            }),
            "Heineken LATA"
        );
    });

    it("não duplica se item já começa com o nome", () => {
        assert.equal(
            buildPackDisplayName({
                productName: "Heineken",
                itemName: "Heineken Long Neck",
                sigla: "UN",
                fatorConversao: 1,
            }),
            "Heineken Long Neck"
        );
    });

    it("fallback volume sem nome do item e sem sigla no título", () => {
        assert.equal(
            buildPackDisplayName({
                productName: "Heineken",
                sigla: "CX",
                volumeQuantidade: 350,
                unitSigla: "ml",
                fatorConversao: 24,
            }),
            "Heineken 350ml"
        );
    });

    it("UN não coloca fator no título", () => {
        assert.equal(
            buildPackDisplayName({
                productName: "Heineken",
                itemName: "LATA",
                sigla: "UN",
                fatorConversao: 1,
            }),
            "Heineken LATA"
        );
    });
});

describe("formatPackSiglaLabel", () => {
    it("UN com quantidade cadastrada", () => {
        assert.equal(formatPackSiglaLabel("UN", 1), "UN:1");
    });

    it("CX com fator cadastrado", () => {
        assert.equal(formatPackSiglaLabel("CX", 8), "CX:8");
    });

    it("outras siglas no mesmo padrão", () => {
        assert.equal(formatPackSiglaLabel("FARD", 6), "FARD:6");
        assert.equal(formatPackSiglaLabel("PAC", 12), "PAC:12");
    });
});

describe("formatMenuPackLabel", () => {
    it("unidade permanece no padrão curto", () => {
        assert.equal(formatMenuPackLabel("UN", 1), "UN:1");
    });

    it("caixa e fardo saem por extenso com a quantidade", () => {
        assert.equal(formatMenuPackLabel("CX", 24), "caixa com: 24");
        assert.equal(formatMenuPackLabel("FARD", 15), "fardo com: 15");
    });

    it("combo não mostra sigla de embalagem", () => {
        assert.equal(formatMenuPackLabel("KIT", 1), "");
    });
});
