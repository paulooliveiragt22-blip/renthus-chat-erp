import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatMenuCustomerAddressLine } from "../../lib/public-menu/formatMenuAddress";

describe("formatMenuCustomerAddressLine", () => {
    it("monta rua, bairro e cidade", () => {
        assert.equal(
            formatMenuCustomerAddressLine({
                logradouro: "Rua das Flores",
                numero: "10",
                bairro: "Centro",
                cidade: "Sorriso",
            }),
            "Rua das Flores, 10 · Centro · Sorriso"
        );
    });

    it("omite partes vazias", () => {
        assert.equal(
            formatMenuCustomerAddressLine({
                logradouro: "Av. Brasil",
                numero: null,
                bairro: "",
                cidade: "Sorriso",
            }),
            "Av. Brasil · Sorriso"
        );
    });

    it("ignora placeholders como S/N e (completar)", () => {
        assert.equal(
            formatMenuCustomerAddressLine({
                logradouro: "Rua turmalina 34 São Mateus",
                numero: "S/N",
                bairro: "(completar)",
                cidade: "",
            }),
            "Rua turmalina 34 São Mateus"
        );
    });

    it("ignora cidade placeholder com hífen", () => {
        assert.equal(
            formatMenuCustomerAddressLine({
                logradouro: "Rua turmalina 34",
                numero: null,
                bairro: "Centro",
                cidade: "-",
            }),
            "Rua turmalina 34 · Centro"
        );
    });
});
