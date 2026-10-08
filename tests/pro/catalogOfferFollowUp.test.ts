import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCatalogOfferFollowUp } from "../../src/pro/pipeline/catalogOfferFollowUp";
import { extractPartySizeRequest } from "../../src/pro/pipeline/partySizeRequest";
import { formatPartySizeReply } from "../../src/pro/pipeline/partySizeOffers";
import {
    applyMinimumOrderNotice,
    pickMinimumGapSuggestions,
} from "../../src/pro/pipeline/minimumGapFill";
import type { OrderDraft } from "../../src/types/contracts";

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

    it("marmita que serve 3 pessoas", () => {
        assert.deepEqual(extractPartySizeRequest("qual marmita me indica que serve 3 pessoas?"), {
            people: 3,
            productHint: "marmita",
        });
    });

    it("typo pessosas ainda é porção", () => {
        assert.deepEqual(
            extractPartySizeRequest("oii\nqual marmita me indica que serve 3 pessosas?"),
            { people: 3, productHint: "marmita" }
        );
    });

    it("serve até 4 pessoas de pizza", () => {
        assert.deepEqual(extractPartySizeRequest("serve até 4 pessoas de pizza"), {
            people: 4,
            productHint: "pizza",
        });
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

function shortDraft(grandTotal: number, min: number | null): OrderDraft {
    return {
        items: [
            {
                produtoEmbalagemId: "skol-cx",
                productName: "SKOL LATA",
                quantity: 1,
                unitPrice: grandTotal,
                fatorConversao: 15,
                siglaComercial: "CX",
                productVolumeId: null,
                estoqueUnidades: 10,
            },
        ],
        address: null,
        paymentMethod: null,
        changeFor: null,
        fulfillmentType: "delivery",
        deliveryFee: 0,
        deliveryZoneId: null,
        deliveryAddressText: null,
        deliveryMinOrder: min,
        deliveryEtaMin: null,
        totalItems: grandTotal,
        grandTotal,
        pendingConfirmation: false,
        version: 1,
    };
}

describe("sugestão para completar o mínimo", () => {
    const catalog = [
        { id: "skol-cx", productName: "SKOL LATA", label: "SKOL LATA (CX c/15)", price: 60, sigla: "CX" },
        { id: "skol-cx-2", productName: "SKOL LONG NECK", label: "SKOL LONG NECK (CX c/12)", price: 48, sigla: "CX" },
        { id: "skol-un", productName: "SKOL LATA", label: "SKOL LATA", price: 5, sigla: "UN" },
        { id: "heine-cx", productName: "HEINEKEN", label: "HEINEKEN (CX c/24)", price: 150, sigla: "CX" },
    ];

    it("prefere outra embalagem da mesma marca e sigla", () => {
        const picks = pickMinimumGapSuggestions({
            draft: [{ produtoEmbalagemId: "skol-cx", productName: "SKOL LATA", sigla: "CX" }],
            catalog,
            accompaniments: [{ id: "batata", productName: "BATATA", label: "Batata frita", price: 12, sigla: "UN" }],
        });
        assert.deepEqual(picks.map((p) => p.produtoEmbalagemId), ["skol-cx-2"]);
    });

    it("sem a mesma embalagem, usa o acompanhamento do cadastro", () => {
        const picks = pickMinimumGapSuggestions({
            draft: [{ produtoEmbalagemId: "skol-cx", productName: "SKOL LATA", sigla: "CX" }],
            catalog: catalog.filter((row) => row.id !== "skol-cx-2"),
            accompaniments: [{ id: "batata", productName: "BATATA", label: "Batata frita", price: 12, sigla: "UN" }],
        });
        assert.deepEqual(picks.map((p) => p.produtoEmbalagemId), ["batata"]);
    });

    it("sem sugestão, pede outro produto e não cita item", () => {
        const out = applyMinimumOrderNotice([], shortDraft(20, 50), [], null);
        const text = String(out[0]?.text ?? "");
        assert.match(text, /outro produto/);
        assert.equal(text.includes("Para completar"), false);
        assert.match(text, /20,00/);
        assert.match(text, /50,00/);
    });

    it("o aviso vem depois do texto do pedido", () => {
        const out = applyMinimumOrderNotice(
            [{ kind: "text", text: "Anotei 1 SKOL LATA (CX c/15)." }],
            shortDraft(20, 50),
            [{ produtoEmbalagemId: "skol-cx-2", label: "SKOL LONG NECK (CX c/12)", price: 48 }],
            null
        );
        assert.match(String(out[0]?.text), /Anotei/);
        assert.match(String(out[1]?.text), /Para completar/);
        assert.match(String(out[1]?.text), /SKOL LONG NECK/);
    });
});
