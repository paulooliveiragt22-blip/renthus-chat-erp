import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCatalogOfferFollowUp } from "../../src/pro/pipeline/catalogOfferFollowUp";
import { extractPartySizeRequest } from "../../src/pro/pipeline/partySizeRequest";
import { formatPartySizeReply } from "../../src/pro/pipeline/partySizeOffers";
import { appendGapFillersToMinimumMessage } from "../../src/pro/pipeline/minimumGapFill";

const skolCx = {
    embalagemId: "5531fa3a-7ed6-4bfa-b119-05cfe2cba1c9",
    label: "SKOL LATA (CX c/15)",
    price: 60,
    productName: "SKOL LATA (CX c/15)",
};

describe("oferta de catálogo — continuação", () => {
    it("Quero a caixa reusa a Skol CX oferecida", () => {
        const hit = resolveCatalogOfferFollowUp("Quero a caixa", [skolCx]);
        assert.deepEqual(hit, { embalagemId: skolCx.embalagemId, quantity: 1 });
    });

    it("pergunta de estoque não vira pedido", () => {
        assert.equal(resolveCatalogOfferFollowUp("Tem caixinha de skol?", [skolCx]), null);
    });

    it("outro produto não herda a oferta", () => {
        assert.equal(resolveCatalogOfferFollowUp("quero heineken", [skolCx]), null);
    });

    it("quero a lata não fecha a caixa", () => {
        assert.equal(resolveCatalogOfferFollowUp("quero a lata", [skolCx]), null);
    });

    it("duas caixas sem número não assume quantidade", () => {
        assert.equal(resolveCatalogOfferFollowUp("quero as caixas", [skolCx]), null);
    });
});

describe("porção para N pessoas", () => {
    it("pizza pra 4 pessoas", () => {
        assert.deepEqual(extractPartySizeRequest("uma pizza pra 4 pessoas, qual recomenda?"), {
            people: 4,
            productHint: "pizza",
        });
    });

    it("quero 4 skol não é porção", () => {
        assert.equal(extractPartySizeRequest("quero 4 skol"), null);
    });

    it("uma opção pede quero essa; duas pedem o número", () => {
        const one = formatPartySizeReply(4, [{ embalagemId: "a", label: "Pizza grande", price: 50, serveAte: 4 }], "pizza");
        assert.match(one, /quero essa/);
        const two = formatPartySizeReply(
            4,
            [
                { embalagemId: "a", label: "Pizza grande", price: 50, serveAte: 4 },
                { embalagemId: "b", label: "Pizza família", price: 70, serveAte: 6 },
            ],
            "pizza"
        );
        assert.match(two, /Digite o número da opção/);
    });
});

describe("sugestão para completar o mínimo", () => {
    it("acrescenta favorito que não está no rascunho", () => {
        const out = appendGapFillersToMinimumMessage(
            [
                {
                    kind: "text",
                    text: "Seu pedido está em R$ 20,00 e o mínimo para entrega é R$ 50,00 (faltam R$ 30,00). Me diga o que mais você quer adicionar.",
                },
            ],
            [
                { produtoEmbalagemId: "ja", label: "SKOL LATA", price: 5 },
                { produtoEmbalagemId: "nova", label: "ORIGINAL LATA (CX c/15)", price: 60 },
            ],
            ["ja"]
        );
        const text = String(out[0]?.text ?? "");
        assert.match(text, /Para completar/);
        assert.match(text, /ORIGINAL LATA/);
        assert.equal(text.includes("SKOL LATA —"), false);
    });
});
