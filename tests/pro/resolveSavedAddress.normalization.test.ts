import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAiAddressFromSavedClienteRow } from "../../src/pro/tools/resolveSavedAddress";

describe("buildAiAddressFromSavedClienteRow", () => {
    it("preenche numero e bairro a partir de logradouro numa linha", () => {
        const a = buildAiAddressFromSavedClienteRow({
            id: "addr-1",
            apelido: "Chatbot",
            logradouro: "Rua turmalina 34 São Mateus",
            numero: null,
            complemento: null,
            bairro: null,
            cidade: "Sorriso",
            estado: "MT",
            cep: null,
            is_principal: true,
        });
        assert.ok(a);
        assert.equal(a?.numero, "34");
        assert.equal(a?.bairro, "São Mateus");
        assert.ok((a?.logradouro ?? "").toLowerCase().includes("turmalina"));
        assert.equal(a?.enderecoClienteId, "addr-1");
    });

    it("mantém campos quando ja estruturados", () => {
        const a = buildAiAddressFromSavedClienteRow({
            id: "addr-2",
            apelido: null,
            logradouro: "Rua A",
            numero: "10",
            complemento: null,
            bairro: "Centro",
            cidade: "X",
            estado: "MT",
            cep: "78000-000",
            is_principal: false,
        });
        assert.ok(a);
        assert.equal(a?.logradouro, "Rua A");
        assert.equal(a?.numero, "10");
        assert.equal(a?.bairro, "Centro");
    });

    it("S/N com bairro e cidade reais continua entregável", () => {
        const a = buildAiAddressFromSavedClienteRow({
            id: "addr-sn",
            apelido: "Sitio",
            logradouro: "Rua Turmalina",
            numero: "S/N",
            complemento: null,
            bairro: "São Mateus",
            cidade: "Sorriso",
            estado: "MT",
            cep: null,
            is_principal: false,
        });
        assert.ok(a);
        assert.equal(a?.numero, "S/N");
    });

    it("principal com bairro - e cidade (completar) não entra na oferta", () => {
        const a = buildAiAddressFromSavedClienteRow({
            id: "addr-chatbot",
            apelido: "Chatbot",
            logradouro: "Rua turmalina",
            numero: "S/N",
            complemento: null,
            bairro: "-",
            cidade: "(completar)",
            estado: "MT",
            cep: null,
            is_principal: true,
        });
        assert.equal(a, null);
    });

    it("número só com pontuação não é entregável", () => {
        const a = buildAiAddressFromSavedClienteRow({
            id: "addr-dot",
            apelido: null,
            logradouro: "Rua A",
            numero: "...",
            complemento: null,
            bairro: "Centro",
            cidade: "Sorriso",
            estado: "MT",
            cep: null,
            is_principal: false,
        });
        assert.equal(a, null);
    });
});
