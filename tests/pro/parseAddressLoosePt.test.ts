import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tryParseAddressOneLine } from "../../src/pro/tools/parseAddressLoosePt";
import { hasCustomerAddressCore } from "../../lib/address/enrichDeliveryAddress";

describe("tryParseAddressOneLine", () => {
    it("rua + número + bairro", () => {
        const p = tryParseAddressOneLine("Rua Tangará 850 São Mateus");
        assert.deepEqual(p, {
            logradouro: "Rua Tangará",
            numero: "850",
            bairro: "São Mateus",
        });
    });

    it("aceita vírgula e prefixo 'aqui na'", () => {
        const p = tryParseAddressOneLine("aqui na rua tangara 850, sao mateus");
        assert.ok(p);
        assert.equal(p!.numero, "850");
        assert.match(p!.logradouro, /tangara/i);
        assert.match(p!.bairro, /sao mateus/i);
    });
});

describe("hasCustomerAddressCore", () => {
    it("não exige cidade/UF do cliente", () => {
        assert.equal(
            hasCustomerAddressCore({
                logradouro: "Rua A",
                numero: "1",
                bairro: "Centro",
                cidade: null,
                estado: null,
                complemento: null,
            }),
            true
        );
        assert.equal(
            hasCustomerAddressCore({
                logradouro: "Rua A",
                numero: "1",
                bairro: "",
                cidade: "Sorriso",
                estado: "MT",
                complemento: null,
            }),
            false
        );
    });
});
