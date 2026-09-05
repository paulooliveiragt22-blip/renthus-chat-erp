import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    formatCardExpiryInput,
    formatCardNumberInput,
    formatCvvInput,
} from "@/lib/billing/cardInputFormatters";
import { validateRenthusCardCheckout } from "@/lib/billing/validateRenthusCardCheckout";

describe("cardInputFormatters", () => {
    it("formata número, validade e CVV", () => {
        assert.equal(formatCardNumberInput("4111111111111111"), "4111 1111 1111 1111");
        assert.equal(formatCardExpiryInput("0828"), "08/28");
        assert.equal(formatCvvInput("12345"), "1234");
    });
});

describe("validateRenthusCardCheckout", () => {
    const addr = {
        cep: "01310100",
        endereco: "Av Paulista",
        numero: "1000",
        bairro: "Bela Vista",
        cidade: "São Paulo",
        uf: "SP",
    };

    it("rejeita validade fora de MM/AA", () => {
        const r = validateRenthusCardCheckout(
            { holder: "Test User", number: "4111111111111111", exp: "1328", cvv: "123" },
            addr,
            "Loja"
        );
        assert.ok("error" in r);
    });

    it("rejeita CVV curto", () => {
        const r = validateRenthusCardCheckout(
            { holder: "Test User", number: "4111111111111111", exp: "12/30", cvv: "12" },
            addr,
            "Loja"
        );
        assert.ok("error" in r);
        assert.match(r.error, /CVV/);
    });

    it("aceita cartão válido", () => {
        const r = validateRenthusCardCheckout(
            { holder: "Test User", number: "4111 1111 1111 1111", exp: "12/30", cvv: "123" },
            addr,
            "Loja"
        );
        assert.ok(!("error" in r));
        assert.equal(r.cvv, "123");
    });
});
