import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildPrepareDraftGuidanceForModel,
    formatPrepareErrorsForClientReply,
    shouldPreferPrepareErrorsOverModelText,
} from "../../lib/chatbot/pro/prepareOrderDraft";

describe("buildPrepareDraftGuidanceForModel", () => {
    it("quando ok, orienta alinhamento ao draft", () => {
        const g = buildPrepareDraftGuidanceForModel(true, []);
        assert.ok(g.some((l) => l.toLowerCase().includes("aceito")));
        assert.ok(g.some((l) => l.toLowerCase().includes("draft")));
    });

    it("quando falta pagamento, sugere próximo passo de payment_method", () => {
        const g = buildPrepareDraftGuidanceForModel(false, ["Informe payment_method: pix, cash ou card."]);
        assert.ok(g.some((l) => l.includes("payment_method")));
        assert.ok(g.some((l) => l.toLowerCase().includes("próximo passo")));
    });

    it("quando estoque, sugere quantidade menor", () => {
        const g = buildPrepareDraftGuidanceForModel(false, ['Estoque insuficiente para "X" (pediu 2).']);
        assert.ok(g.some((l) => l.toLowerCase().includes("estoque")));
    });
});

describe("prepareOrderDraft / resposta ao cliente após rejeição", () => {
    it("formatPrepareErrorsForClientReply lista erros", () => {
        const msg = formatPrepareErrorsForClientReply([
            "Endereço incompleto: obrigatório rua, número e bairro.",
            "Endereço incompleto: obrigatório rua, número e bairro.",
        ]);
        assert.match(msg, /Endereço incompleto/u);
        assert.ok(msg.includes("•"));
    });

    it("shouldPrefer: sim quando prepare falhou, sem draft e modelo genérico", () => {
        assert.equal(
            shouldPreferPrepareErrorsOverModelText({
                visible: "Tivemos um problema técnico ao validar.",
                hasDraftItems: false,
                prepareOk: false,
                errors: ["Informe payment_method: pix, cash ou card."],
            }),
            true
        );
    });

    it("shouldPrefer: não quando já há itens no draft (outro caminho trata)", () => {
        assert.equal(
            shouldPreferPrepareErrorsOverModelText({
                visible: "Problema técnico.",
                hasDraftItems: true,
                prepareOk: false,
                errors: ["x"],
            }),
            false
        );
    });

    it("shouldPrefer: não quando não houve prepare nesta volta", () => {
        assert.equal(
            shouldPreferPrepareErrorsOverModelText({
                visible: "Problema técnico.",
                hasDraftItems: false,
                prepareOk: null,
                errors: [],
            }),
            false
        );
    });

    it("shouldPrefer: não quando prepare ok", () => {
        assert.equal(
            shouldPreferPrepareErrorsOverModelText({
                visible: "Resumo curto",
                hasDraftItems: false,
                prepareOk: true,
                errors: [],
            }),
            false
        );
    });
});
