import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    formatCanonicalDraftSummary,
    formatSearchPicksClarificationBody,
} from "../../src/pro/pipeline/orderDraftPresenter";
import type { OrderDraft } from "../../src/types/contracts";

describe("orderDraftPresenter", () => {
    it("resumo inclui taxa e total canónicos", () => {
        const draft: OrderDraft = {
            items: [
                {
                    produtoEmbalagemId: "pe-1",
                    productName: "HEINEKEN LONGNECK",
                    quantity: 1,
                    unitPrice: 60,
                    fatorConversao: 6,
                    siglaComercial: "CX",
                    productVolumeId: null,
                    estoqueUnidades: 10,
                },
            ],
            address: {
                logradouro: "Rua A",
                numero: "1",
                bairro: "Centro",
                cidade: "Sorriso",
                estado: "MT",
                complemento: null,
            },
            paymentMethod: "pix",
            changeFor: null,
            deliveryFee: 15,
            deliveryZoneId: "z1",
            deliveryAddressText: null,
            deliveryMinOrder: null,
            deliveryEtaMin: null,
            totalItems: 60,
            grandTotal: 75,
            pendingConfirmation: true,
            version: 1,
        };
        const s = formatCanonicalDraftSummary(draft);
        assert.match(s, /1× HEINEKEN LONGNECK \(CX:6\) — R\$ 60,00/);
        assert.match(s, /Taxa de entrega: R\$ 15,00/);
        assert.match(s, /Total: R\$ 75,00/);
        assert.match(s, /PIX/);
    });

    it("inclui observação do pedido no resumo", () => {
        const draft: OrderDraft = {
            items: [
                {
                    produtoEmbalagemId: "a",
                    productName: "Hambúrguer",
                    quantity: 1,
                    unitPrice: 25,
                    fatorConversao: 1,
                    productVolumeId: null,
                    estoqueUnidades: 10,
                },
            ],
            address: {
                logradouro: "Rua A",
                numero: "1",
                bairro: "Centro",
                cidade: "Sorriso",
                estado: "MT",
                complemento: null,
            },
            paymentMethod: "pix",
            changeFor: null,
            deliveryFee: 0,
            deliveryZoneId: null,
            deliveryAddressText: "Rua A, 1",
            deliveryMinOrder: null,
            deliveryEtaMin: null,
            totalItems: 25,
            grandTotal: 25,
            pendingConfirmation: true,
            orderNotes: "sem alface",
            version: 1,
        };
        const s = formatCanonicalDraftSummary(draft);
        assert.match(s, /Obs\.: sem alface/);
    });

    it("clarificação lista preços e pede número", () => {
        const body = formatSearchPicksClarificationBody([
            { embalagemId: "a", label: "UN", price: 10 },
            { embalagemId: "b", label: "CX", price: 60 },
        ]);
        assert.match(body, /1\) UN — R\$ 10,00/);
        assert.match(body, /número/i);
    });

    it("clarificação com hint do produto", () => {
        const body = formatSearchPicksClarificationBody(
            [
                { embalagemId: "a", label: "UN", price: 5 },
                { embalagemId: "b", label: "CX", price: 90 },
            ],
            { productHint: "trezentinha" }
        );
        assert.match(body, /Qual opção de trezentinha/i);
    });
});
