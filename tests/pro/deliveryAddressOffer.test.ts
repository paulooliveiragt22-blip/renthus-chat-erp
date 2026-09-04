import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AddressDeliveryStat } from "../../src/pro/tools/resolveSavedAddress";
import {
    buildDeliveryAddressOfferOutbound,
    listCompleteSavedAddresses,
    parseAddressOfferIndex,
    pickProposedDeliveryAddress,
} from "../../src/pro/pipeline/deliveryAddressOffer";

const casa = {
    id: "addr-casa",
    apelido: "Casa",
    logradouro: "Rua Tangará",
    numero: "850",
    complemento: null,
    bairro: "São Mateus",
    cidade: "Sorriso",
    estado: "MT",
    cep: null,
    is_principal: true,
};

const trampo = {
    id: "addr-trampo",
    apelido: "Trampo",
    logradouro: "Rua Parma",
    numero: "1433",
    complemento: null,
    bairro: "Vila Romana",
    cidade: "Sorriso",
    estado: "MT",
    cep: null,
    is_principal: false,
};

describe("deliveryAddressOffer", () => {
    it("propõe o último usado (lastDeliveredAt), não o principal", () => {
        const stats: AddressDeliveryStat[] = [
            { address: casa, deliveryCount: 10, lastDeliveredAt: "2025-01-01T00:00:00Z" },
            { address: trampo, deliveryCount: 1, lastDeliveredAt: "2026-06-01T00:00:00Z" },
        ];
        const complete = listCompleteSavedAddresses(stats);
        const proposed = pickProposedDeliveryAddress(stats, complete);
        assert.equal(proposed?.id, "addr-trampo");
    });

    it("mensagem: pergunta o proposto + lista numerada dos outros + Confirmar/Novo", () => {
        const out = buildDeliveryAddressOfferOutbound({
            proposed: trampo,
            others: [casa],
        });
        assert.equal(out.length, 1);
        assert.equal(out[0]!.kind, "buttons");
        const text = out[0]!.text ?? "";
        assert.ok(text.includes("O endereço de entrega é"));
        assert.ok(text.includes("Trampo"));
        assert.ok(text.includes("Temos estes outros cadastrados:"));
        assert.ok(text.includes("1. Casa:"));
        assert.ok(text.includes("Digite o número correspondente"));
        assert.deepEqual(
            out[0]!.buttons?.map((b) => b.id),
            ["pro_confirm_saved_address", "pro_new_address_flow"]
        );
        assert.deepEqual(
            out[0]!.buttons?.map((b) => b.title),
            ["Confirmar", "Novo"]
        );
    });

    it("só 1 endereço: sem lista numerada", () => {
        const out = buildDeliveryAddressOfferOutbound({ proposed: casa, others: [] });
        const text = out[0]!.text ?? "";
        assert.ok(!text.includes("Temos estes outros"));
        assert.ok(text.includes("Use os botões abaixo"));
    });

    it("parseAddressOfferIndex: 1..N nos outros", () => {
        assert.equal(parseAddressOfferIndex("1", 2), 1);
        assert.equal(parseAddressOfferIndex("2", 2), 2);
        assert.equal(parseAddressOfferIndex("3", 2), null);
        assert.equal(parseAddressOfferIndex("quero 1", 2), null);
        assert.equal(parseAddressOfferIndex("1", 0), null);
    });
});
