import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    EMPTY_INBOUND_SLOTS,
    extractInboundSlots,
    parseChangeForFromText,
} from "../../src/pro/domain/inboundSlots/extractInboundSlots";

/** Frase do sintoma que motivou o ADR 0012 (2026-09-21). */
const FULL_MESSAGE =
    "manda duas caixas de original lata e 3 caixa de Heineken longneck aqui na rua tangara 850, sao mateus. pagamento no pix";

describe("extractInboundSlots", () => {
    it("mensagem completa: itens + endereço + pagamento no mesmo texto", () => {
        const slots = extractInboundSlots(FULL_MESSAGE);
        assert.equal(slots.paymentMethod, "pix");
        assert.ok(slots.addressLine);
        assert.equal(slots.address?.numero, "850");
        assert.match(slots.address?.logradouro ?? "", /tangara/i);
        assert.match(slots.address?.bairro ?? "", /mateus/i);
        assert.ok(slots.orderLines.length >= 2, "dois produtos na frase");
        assert.ok(
            slots.orderLines.every((l) => !/rua|pix|pagamento/i.test(l.rawTerm)),
            "termo de produto não pode carregar endereço/pagamento"
        );
    });

    it("texto vazio: envelope vazio (turno de botão)", () => {
        const slots = extractInboundSlots("");
        assert.equal(slots.addressLine, null);
        assert.equal(slots.paymentMethod, null);
        assert.equal(slots.fulfillmentType, null);
        assert.deepEqual(slots.orderLines, []);
    });

    it("não inventa endereço a partir de texto solto", () => {
        const slots = extractInboundSlots("quero duas coca 2l geladas");
        assert.equal(slots.addressLine, null);
        assert.equal(slots.address, null);
    });

    it("modalidade: retirada vence menção a entrega", () => {
        assert.equal(extractInboundSlots("não quero entrega, vou buscar").fulfillmentType, "pickup");
        assert.equal(extractInboundSlots("pode entregar por favor").fulfillmentType, "delivery");
        assert.equal(extractInboundSlots("quero 2 skol").fulfillmentType, null);
    });

    it("selo: mesmo texto, mesmo hash; texto diferente, hash diferente", () => {
        assert.equal(
            extractInboundSlots(FULL_MESSAGE).sourceTextHash,
            extractInboundSlots(FULL_MESSAGE).sourceTextHash
        );
        assert.notEqual(
            extractInboundSlots("a").sourceTextHash,
            extractInboundSlots("b").sourceTextHash
        );
    });

    it("é pura: roda sem client, sem rede e não muta o envelope vazio", () => {
        const before = JSON.stringify(EMPTY_INBOUND_SLOTS);
        extractInboundSlots(FULL_MESSAGE);
        assert.equal(JSON.stringify(EMPTY_INBOUND_SLOTS), before);
    });
});

describe("parseChangeForFromText", () => {
    it("aceita mensagem que é só o valor (turno de troco)", () => {
        assert.equal(parseChangeForFromText("100"), 100);
        assert.equal(parseChangeForFromText("R$ 50,00"), 50);
    });

    it("aceita troco explícito dentro da frase", () => {
        assert.equal(parseChangeForFromText("dinheiro, troco pra 100"), 100);
        assert.equal(parseChangeForFromText("vou pagar em dinheiro troco de R$ 80"), 80);
    });

    it("não inventa troco sem a palavra troco", () => {
        assert.equal(parseChangeForFromText("quero 3 coca 2l"), null);
        assert.equal(parseChangeForFromText("rua tangara 850"), null);
    });
});
