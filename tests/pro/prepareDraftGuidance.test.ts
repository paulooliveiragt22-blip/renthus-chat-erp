import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildPrepareDraftGuidanceForModel,
    formatPrepareErrorsForClientReply,
    shouldPreferPrepareErrorsOverModelText,
} from "../../src/pro/tools/prepareOrderDraft";

describe("buildPrepareDraftGuidanceForModel", () => {
    it("quando ok, nao pede confirmar endereco nem inventar totais", () => {
        const g = buildPrepareDraftGuidanceForModel(true, [], {
            deliveryAddressUiConfirmed: false,
        });
        const blob = g.join("\n");
        assert.match(blob, /aceito/i);
        assert.match(blob, /NÃO invente|NAO invente/i);
        assert.match(blob, /confirmação de endereço|confirmacao de endereco/i);
    });

    it("quando ok (flag UI true), mesma politica de resumo no servidor", () => {
        const g = buildPrepareDraftGuidanceForModel(true, [], {
            deliveryAddressUiConfirmed: true,
        });
        assert.ok(g.some((l) => l.toLowerCase().includes("servidor")));
    });

    it("quando falta pagamento, sugere próximo passo de payment_method", () => {
        const g = buildPrepareDraftGuidanceForModel(false, ["Informe payment_method: pix, cash ou card."]);
        assert.ok(g.some((l) => l.includes("payment_method")));
        assert.ok(g.some((l) => l.toLowerCase().includes("próximo passo")));
    });

    it("quando abaixo do pedido mínimo, prioriza mínimo sobre pagamento e não sugere confirmar", () => {
        const g = buildPrepareDraftGuidanceForModel(false, ["Pedido mínimo para entrega: R$ 50,00."], {
            hasPartialDraft: true,
            blocked: { code: "BELOW_MIN_ORDER", missing: 50, minOrder: 50 },
        });
        const blob = g.join("\n").toLowerCase();
        assert.ok(blob.includes("mínimo") || blob.includes("minimo"));
        assert.ok(blob.includes("não pergunte forma de pagamento") || blob.includes("nao pergunte forma de pagamento"));
    });

    it("quando troco inválido, orienta pedir valor correto (não confirma pedido)", () => {
        const g = buildPrepareDraftGuidanceForModel(
            false,
            ["Troco informado (R$ 20,00) é menor que o total do pedido (R$ 50,00)."],
            {
                hasPartialDraft: true,
                blocked: { code: "INVALID_CHANGE_FOR", grandTotal: 50, changeFor: 20 },
            }
        );
        const blob = g.join("\n").toLowerCase();
        assert.ok(blob.includes("troco"));
        assert.ok(blob.includes("50,00") || blob.includes("50"));
    });

    it("quando estoque, sugere quantidade menor", () => {
        const g = buildPrepareDraftGuidanceForModel(false, ['Estoque insuficiente para "X" (pediu 2).']);
        assert.ok(g.some((l) => l.toLowerCase().includes("estoque")));
    });

    it("quando slug inválido, sugere copiar id UUID do search", () => {
        const g = buildPrepareDraftGuidanceForModel(false, [
            "Cada item.produto_embalagem_id deve ser o UUID (campo id) copiado do array items do último search_produtos — não use slug, sku textual nem rótulo. Copie o id exato do JSON.",
        ]);
        assert.ok(g.some((l) => l.toLowerCase().includes("slug")));
    });
});

describe("prepareOrderDraft / resposta ao cliente após rejeição", () => {
    it("formatPrepareErrorsForClientReply lista erros", () => {
        const msg = formatPrepareErrorsForClientReply([
            "Endereço incompleto: obrigatório rua, número, bairro e cidade.",
            "Endereço incompleto: obrigatório rua, número, bairro e cidade.",
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
