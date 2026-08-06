import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    WA_BUTTON_TITLE_MAX,
    numberedPickTitle,
    ensureUniqueButtonTitles,
    buildUniquePickButtons,
    formatButtonsFallbackText,
} from "../../src/pro/pipeline/pickButtonTitles";
import { PICK_EMB_PREFIX } from "../../src/pro/pipeline/productPickText";

describe("numberedPickTitle", () => {
    it("cabe em 20 chars e usa prefixo N)", () => {
        const t = numberedPickTitle(1, "ORIGINAL TREZENTINHA");
        assert.ok(t.length <= WA_BUTTON_TITLE_MAX);
        assert.ok(t.startsWith("1) "));
    });

    it("diferencia UN e CX que truncariam iguais", () => {
        const a = numberedPickTitle(1, "ORIGINAL TREZENTINHA");
        const b = numberedPickTitle(2, "ORIGINAL TREZENTINHA (CX c/23)");
        assert.notEqual(a, b);
        assert.equal(a, "1) ORIGINAL TREZENTI");
        assert.equal(b, "2) ORIGINAL TREZENTI");
        assert.equal(a.length, WA_BUTTON_TITLE_MAX);
        assert.equal(b.length, WA_BUTTON_TITLE_MAX);
    });
});

describe("ensureUniqueButtonTitles", () => {
    it("mantém títulos já únicos", () => {
        assert.deepEqual(ensureUniqueButtonTitles(["1) UN", "2) CX"]), ["1) UN", "2) CX"]);
    });

    it("reprefixa colisões residuais", () => {
        const out = ensureUniqueButtonTitles(["MESMO", "MESMO", "MESMO"]);
        assert.equal(new Set(out.map((t) => t.toLowerCase())).size, 3);
        for (const t of out) assert.ok(t.length <= WA_BUTTON_TITLE_MAX);
    });
});

describe("buildUniquePickButtons", () => {
    it("monta ids pro_pick_emb e títulos únicos ≤20", () => {
        const buttons = buildUniquePickButtons([
            { embalagemId: "un-id", label: "ORIGINAL TREZENTINHA" },
            { embalagemId: "cx-id", label: "ORIGINAL TREZENTINHA (CX c/23)" },
        ]);
        assert.equal(buttons.length, 2);
        assert.equal(buttons[0]!.id, `${PICK_EMB_PREFIX}un-id`);
        assert.equal(buttons[1]!.id, `${PICK_EMB_PREFIX}cx-id`);
        const titles = buttons.map((b) => b.title);
        assert.equal(new Set(titles).size, titles.length);
        for (const t of titles) assert.ok(t.length <= WA_BUTTON_TITLE_MAX);
    });

    it("limita a 3 opções", () => {
        const buttons = buildUniquePickButtons([
            { embalagemId: "a", label: "A" },
            { embalagemId: "b", label: "B" },
            { embalagemId: "c", label: "C" },
            { embalagemId: "d", label: "D" },
        ]);
        assert.equal(buttons.length, 3);
        assert.deepEqual(
            buttons.map((b) => b.title),
            ["1) A", "2) B", "3) C"]
        );
    });
});

describe("formatButtonsFallbackText", () => {
    it("reusa body com lista numerada e remove 'Toque no botao'", () => {
        const body =
            "Qual opcao voce quer?\n\n1) ORIGINAL TREZENTINHA — R$ 5,00\n2) ORIGINAL TREZENTINHA (CX c/23) — R$ 100,00\n\nToque no botao ou responda com o numero (ex.: 2).";
        const out = formatButtonsFallbackText(body, [
            { id: "x", title: "1) ORIGINAL TREZENT" },
            { id: "y", title: "2) ORIGINAL TREZENT" },
        ]);
        assert.match(out, /Responda com o numero da opcao/i);
        assert.doesNotMatch(out, /Toque no botao/i);
        assert.match(out, /ORIGINAL TREZENTINHA \(CX c\/23\)/);
    });

    it("monta lista a partir dos botões quando body não tem 1)", () => {
        const out = formatButtonsFallbackText("Escolha:", [
            { id: "a", title: "1) UN" },
            { id: "b", title: "2) CX" },
        ]);
        assert.match(out, /^Escolha:/);
        assert.match(out, /1\) UN/);
        assert.match(out, /2\) CX/);
        assert.match(out, /Responda com o numero/i);
    });
});
