import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    extractAddressLineFromText,
    tryParseAddressOneLine,
} from "../../src/pro/tools/parseAddressLoosePt";
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

describe("extractAddressLineFromText", () => {
    it("recorta endereço de mensagem com itens e pagamento", () => {
        const line = extractAddressLineFromText(
            "manda duas caixas de original lata e 3 caixa de Heineken longneck aqui na Rua das Turmalinas, 1627  Industrial 1ª Etapa pagamento no pix"
        );
        assert.ok(line, "esperava recorte de endereço");
        const parsed = tryParseAddressOneLine(line!);
        assert.ok(parsed);
        assert.match(parsed!.logradouro, /turmalinas/i);
        assert.equal(parsed!.numero, "1627");
        assert.match(parsed!.bairro, /industrial/i);
    });

    it("mensagem sem endereço não vira endereço", () => {
        assert.equal(extractAddressLineFromText("manda duas caixas de original lata"), null);
        assert.equal(extractAddressLineFromText("quero pagar no pix"), null);
        assert.equal(extractAddressLineFromText("na rua"), null);
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
