import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    applyCepLookup,
    cepDigits,
    describeSavedAddress,
    EMPTY_ADDRESS_FORM,
    formatCepInput,
    isAddressFormComplete,
    savedAddressToForm,
    withServiceAreaDefaults,
} from "@/lib/whatsapp/savedAddress";
import type { SavedCustomerAddress } from "@/lib/whatsapp/types";

const SAVED: SavedCustomerAddress = {
    id: "addr-1",
    apelido: "Casa",
    logradouro: "Rua das Palmeiras",
    numero: "34",
    complemento: "Fundos",
    bairro: "Centro",
    cidade: "",
    estado: "",
    cep: "78898075",
    isPrincipal: true,
};

describe("CEP — máscara e dígitos", () => {
    it("mascara enquanto digita e ignora não-dígito", () => {
        assert.equal(formatCepInput("788"), "788");
        assert.equal(formatCepInput("78898"), "78898");
        assert.equal(formatCepInput("78898075"), "78898-075");
        assert.equal(formatCepInput("78.898-075"), "78898-075");
    });

    it("descarta excedente além de 8 dígitos", () => {
        assert.equal(cepDigits("78898075999"), "78898075");
        assert.equal(formatCepInput("78898075999"), "78898-075");
    });
});

describe("endereço salvo → formulário", () => {
    it("usa cidade/UF da área de atendimento quando o cadastro não tem", () => {
        const form = savedAddressToForm(SAVED, { cidade: "Juína", estado: "mt" });
        assert.equal(form.logradouro, "Rua das Palmeiras");
        assert.equal(form.numero, "34");
        assert.equal(form.cidade, "Juína");
        assert.equal(form.estado, "MT");
        assert.equal(form.cep, "78898-075");
    });

    it("cidade/UF do próprio cadastro têm precedência sobre o default", () => {
        const form = savedAddressToForm(
            { ...SAVED, cidade: "Cuiabá", estado: "MT" },
            { cidade: "Juína", estado: "MT" }
        );
        assert.equal(form.cidade, "Cuiabá");
    });

    it("descrição curta junta rua, número e bairro", () => {
        assert.equal(describeSavedAddress(SAVED), "Rua das Palmeiras, 34 — Centro");
    });
});

describe("defaults da área de atendimento", () => {
    it("só preenche campo vazio", () => {
        const form = withServiceAreaDefaults(
            { ...EMPTY_ADDRESS_FORM, cidade: "Vilhena", estado: "" },
            { cidade: "Juína", estado: "MT" }
        );
        assert.equal(form.cidade, "Vilhena");
        assert.equal(form.estado, "MT");
    });
});

describe("ViaCEP sobre o formulário", () => {
    it("sobrescreve rua/bairro/cidade/UF e preserva número e complemento", () => {
        const before = {
            ...EMPTY_ADDRESS_FORM,
            numero: "34",
            complemento: "Fundos",
            logradouro: "digitado errado",
        };
        const after = applyCepLookup(before, {
            cep: "78898075",
            logradouro: "Rua das Palmeiras",
            bairro: "Centro",
            localidade: "Juína",
            uf: "MT",
        });
        assert.equal(after.logradouro, "Rua das Palmeiras");
        assert.equal(after.bairro, "Centro");
        assert.equal(after.cidade, "Juína");
        assert.equal(after.estado, "MT");
        assert.equal(after.numero, "34");
        assert.equal(after.complemento, "Fundos");
        assert.equal(after.cep, "78898-075");
    });

    it("CEP sem logradouro (cidade inteira) não apaga o que o atendente digitou", () => {
        const before = { ...EMPTY_ADDRESS_FORM, logradouro: "Av. Brasil", bairro: "Jardim" };
        const after = applyCepLookup(before, {
            cep: "78890000",
            logradouro: "",
            bairro: "",
            localidade: "Juína",
            uf: "MT",
        });
        assert.equal(after.logradouro, "Av. Brasil");
        assert.equal(after.bairro, "Jardim");
        assert.equal(after.cidade, "Juína");
    });
});

describe("validação de endereço completo", () => {
    it("exige rua, número, bairro, cidade e UF", () => {
        const base = {
            logradouro: "Rua X", numero: "1", complemento: "", bairro: "Centro",
            cidade: "Juína", estado: "MT", cep: "",
        };
        assert.equal(isAddressFormComplete(base), true);
        assert.equal(isAddressFormComplete({ ...base, numero: "  " }), false);
        assert.equal(isAddressFormComplete({ ...base, estado: "M" }), false);
        assert.equal(isAddressFormComplete(EMPTY_ADDRESS_FORM), false);
    });
});
