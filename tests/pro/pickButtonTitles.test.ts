import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildUniquePickButtons,
    formatPickButtonTitle,
} from "../../src/pro/pipeline/pickButtonTitles";

describe("pickButtonTitles", () => {
    it("trezentinha UN vs CX nao colidem no limite de 20 chars", () => {
        const titles = [
            formatPickButtonTitle("ORIGINAL TREZENTINHA", 0),
            formatPickButtonTitle("ORIGINAL TREZENTINHA (CX c/23)", 1),
            formatPickButtonTitle("WYSK ORIGINAL (2) TREZENTINHA", 2),
        ];
        assert.equal(new Set(titles.map((t) => t.toLowerCase())).size, 3);
        assert.ok(titles.every((t) => t.length <= 20));
    });

    it("buildUniquePickButtons gera ids com prefixo", () => {
        const buttons = buildUniquePickButtons(
            [
                { embalagemId: "a", label: "ORIGINAL TREZENTINHA" },
                { embalagemId: "b", label: "ORIGINAL TREZENTINHA (CX c/23)" },
            ],
            "pro_pick_emb:"
        );
        assert.equal(buttons[0]?.id, "pro_pick_emb:a");
        assert.equal(buttons[1]?.id, "pro_pick_emb:b");
        assert.notEqual(buttons[0]?.title.toLowerCase(), buttons[1]?.title.toLowerCase());
    });
});
