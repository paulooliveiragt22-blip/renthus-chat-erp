import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    formatCardExpiryInput,
    formatCardNumberInput,
    formatCvvInput,
    formatHolderDocumentInput,
} from "@/lib/billing/cardInputFormatters";
import { validateRenthusCardCheckout } from "@/lib/billing/validateRenthusCardCheckout";

describe("cardInputFormatters", () => {
    it("formata número, validade e CVV", () => {
        assert.equal(formatCardNumberInput("4111111111111111"), "4111 1111 1111 1111");
        assert.equal(formatCardExpiryInput("0828"), "08/28");
        assert.equal(formatCvvInput("12345"), "1234");
    });

    it("formata CPF e CNPJ do titular", () => {
        assert.equal(formatHolderDocumentInput("39053344705"), "390.533.447-05");
        assert.equal(formatHolderDocumentInput("11444777000161"), "11.444.777/0001-61");
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
    const baseCard = {
        holder: "Test User",
        holder_document: "39053344705",
        number: "4111111111111111",
        exp: "12/30",
        cvv: "123",
    };

    it("rejeita validade fora de MM/AA", () => {
        const r = validateRenthusCardCheckout(
            { ...baseCard, exp: "1328" },
            addr,
            "Loja"
        );
        assert.ok("error" in r);
    });

    it("rejeita CVV curto", () => {
        const r = validateRenthusCardCheckout(
            { ...baseCard, cvv: "12" },
            addr,
            "Loja"
        );
        assert.ok("error" in r);
        assert.match(r.error, /CVV/);
    });

    it("exige CPF/CNPJ do titular", () => {
        const r = validateRenthusCardCheckout(
            { ...baseCard, holder_document: "" },
            addr,
            "Loja"
        );
        assert.ok("error" in r);
        assert.match(r.error, /titular/);
    });

    it("rejeita documento do titular inválido", () => {
        const r = validateRenthusCardCheckout(
            { ...baseCard, holder_document: "11111111111" },
            addr,
            "Loja"
        );
        assert.ok("error" in r);
        assert.match(r.error, /titular/);
    });

    it("aceita cartão válido com CPF do titular", () => {
        const r = validateRenthusCardCheckout(
            {
                ...baseCard,
                number: "4111 1111 1111 1111",
                holder_document: "390.533.447-05",
            },
            addr,
            "Loja"
        );
        assert.ok(!("error" in r));
        assert.equal(r.cvv, "123");
        assert.equal(r.holderDocument, "39053344705");
    });
});
