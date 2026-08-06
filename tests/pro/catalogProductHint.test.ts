import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { catalogProductHintFromPicks } from "../../src/pro/pipeline/catalogProductHint";

describe("catalogProductHintFromPicks", () => {
    it("usa productName compartilhado entre picks", () => {
        const hint = catalogProductHintFromPicks([
            { label: "Heineken Long Neck UN", productName: "Heineken Long Neck" },
            { label: "Heineken Long Neck CX", productName: "Heineken Long Neck" },
        ]);
        assert.equal(hint, "Heineken Long Neck");
    });

    it("usa stem comum dos labels quando productName diverge", () => {
        const hint = catalogProductHintFromPicks([
            { label: "Salgadinho Fandangos 90g UN" },
            { label: "Salgadinho Fandangos 90g CX" },
        ]);
        assert.equal(hint, "Salgadinho Fandangos 90g");
    });

    it("nao ecoa texto do cliente — sem picks retorna null", () => {
        assert.equal(catalogProductHintFromPicks([]), null);
    });
});
