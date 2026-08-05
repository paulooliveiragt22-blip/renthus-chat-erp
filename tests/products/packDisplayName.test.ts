import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPackDisplayName } from "../../lib/products/packDisplayName";

describe("buildPackDisplayName", () => {
    it("une produto + nome do item", () => {
        assert.equal(
            buildPackDisplayName({ productName: "Heineken", itemName: "CX 15UN" }),
            "Heineken CX 15UN"
        );
    });

    it("não duplica se item já começa com o nome", () => {
        assert.equal(
            buildPackDisplayName({ productName: "Heineken", itemName: "Heineken Long Neck" }),
            "Heineken Long Neck"
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
});
