import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    classifyFiscalDocument,
    isValidCnpj,
    isValidCpf,
} from "../../lib/billing/brazilianFiscalDocument";

describe("brazilianFiscalDocument", () => {
    it("accepts well-known valid CNPJ", () => {
        assert.equal(isValidCnpj("11444777000161"), true);
        assert.equal(isValidCnpj("11.444.777/0001-61"), true);
    });

    it("rejects company CNPJ with wrong check digits (Pagar.me Invalid CNPJ)", () => {
        assert.equal(isValidCnpj("02856659000125"), false);
        assert.equal(classifyFiscalDocument("02856659000125").valid, false);
        assert.equal(classifyFiscalDocument("02856659000125").kind, "CNPJ");
    });

    it("rejects same-digit and short documents", () => {
        assert.equal(isValidCnpj("00000000000000"), false);
        assert.equal(isValidCnpj("123"), false);
        assert.equal(isValidCpf("00000000000"), false);
    });

    it("accepts a valid CPF", () => {
        assert.equal(isValidCpf("39053344705"), true);
        assert.equal(classifyFiscalDocument("390.533.447-05").kind, "CPF");
        assert.equal(classifyFiscalDocument("390.533.447-05").valid, true);
    });
});
