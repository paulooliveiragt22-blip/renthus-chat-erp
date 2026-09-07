import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    preferRowsMatchingTagAliases,
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

    it("rowTagTokens split vírgula", () => {
        assert.deepEqual(rowTagTokens("caixinha, fardinho", null).sort(), [
            "caixinha",
            "fardinho",
        ]);
    });

    it("caixinha + original → só ORIGINAL LATA CX com tag", () => {
        const rows = [
            {
                id: "cx600",
                product_name: "ORIGINAL",
                display_name: "ORIGINAL 600ML (CX c/24)",
                tags: null,
            },
            {
                id: "un600",
                product_name: "ORIGINAL",
                display_name: "ORIGINAL 600ML",
                tags: null,
            },
            {
                id: "lata-un",
                product_name: "ORIGINAL",
                display_name: "ORIGINAL LATA",
                tags: null,
            },
            {
                id: "lata-cx",
                product_name: "ORIGINAL",
                display_name: "ORIGINAL LATA (CX c/15)",
                tags: "caixinha, fardinho",
            },
            {
                id: "heineken-cx",
                product_name: "HEINEKEN",
                display_name: "HEINEKEN LATA (CX c/8)",
                tags: "caixinha de heineken",
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

    it("só caixinha sem marca → todas com tag caixinha", () => {
        const rows = [
            {
                id: "lata-cx",
                product_name: "ORIGINAL",
                tags: "caixinha, fardinho",
            },
            {
                id: "heineken-cx",
                product_name: "HEINEKEN",
                tags: "caixinha de heineken",
            },
            { id: "other", product_name: "SKOL", tags: null },
        ];
        const out = preferRowsMatchingTagAliases(rows, "caixinha", "me manda uma caixinha");
        assert.deepEqual(
            out.map((r) => r.id).sort(),
            ["heineken-cx", "lata-cx"]
        );
    });

    it("tags_auto com nome do produto não anula brandHit (só tags manuais)", () => {
        const rows = [
            {
                id: "lata-cx",
                product_name: "ORIGINAL",
                display_name: "ORIGINAL LATA (CX c/15)",
                tags: "caixinha, fardinho",
                tags_auto: "ORIGINAL LATA 269 ml caixinha, fardinho",
            },
            {
                id: "un600",
                product_name: "ORIGINAL",
                display_name: "ORIGINAL 600ML",
                tags: null,
                tags_auto: "ORIGINAL 600ML 600 ml",
            },
            {
                id: "heineken-cx",
                product_name: "HEINEKEN",
                display_name: "HEINEKEN LATA (CX c/8)",
                tags: "caixinha de heineken",
                tags_auto: "HEINEKEN LATA 269 ml caixinha de heineken",
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
});
