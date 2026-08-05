import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildPackDisplayName,
    formatPackSiglaLabel,
} from "../../lib/products/packDisplayName";

describe("buildPackDisplayName", () => {
    it("une produto + nome do item e acrescenta fator da sigla", () => {
        assert.equal(
            buildPackDisplayName({
                productName: "Heineken",
                itemName: "CX 15UN",
                sigla: "CX",
                fatorConversao: 15,
            }),
            "Heineken CX 15UN (CX c/15)"
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
            "Heineken Long Neck (UN c/1)"
        );
    });

    it("fallback com sigla/volume sem nome do item", () => {
        assert.equal(
            buildPackDisplayName({
                productName: "Heineken",
                sigla: "CX",
                volumeQuantidade: 350,
                unitSigla: "ml",
                fatorConversao: 24,
            }),
            "Heineken 350ml (CX c/24)"
        );
    });

    it("UN também mostra fator", () => {
        assert.equal(
            buildPackDisplayName({
                productName: "Heineken",
                itemName: "LATA",
                sigla: "UN",
                fatorConversao: 1,
            }),
            "Heineken LATA (UN c/1)"
        );
    });

    it("com nome do item ainda acrescenta c/fator na CX", () => {
        assert.equal(
            buildPackDisplayName({
                productName: "Heineken",
                itemName: "LATA",
                sigla: "CX",
                fatorConversao: 8,
            }),
            "Heineken LATA (CX c/8)"
        );
    });

    it("não duplica c/fator se já estiver no nome", () => {
        assert.equal(
            buildPackDisplayName({
                productName: "Heineken",
                itemName: "CX c/15",
                sigla: "CX",
                fatorConversao: 15,
            }),
            "Heineken CX c/15"
        );
    });
});

describe("formatPackSiglaLabel", () => {
    it("UN com fator", () => {
        assert.equal(formatPackSiglaLabel("UN", 1), "UN c/1");
    });

    it("CX com fator", () => {
        assert.equal(formatPackSiglaLabel("CX", 8), "CX c/8");
    });

    it("todas as siglas mostram fator", () => {
        assert.equal(formatPackSiglaLabel("FARD", 6), "FARD c/6");
        assert.equal(formatPackSiglaLabel("PAC", 12), "PAC c/12");
    });
});
