import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAiAddressFromSavedClienteRow } from "../../lib/chatbot/pro/resolveSavedAddress";

describe("buildAiAddressFromSavedClienteRow", () => {
    it("preenche numero e bairro a partir de logradouro numa linha", () => {
        const a = buildAiAddressFromSavedClienteRow({
            id: "addr-1",
            apelido: "Chatbot",
            logradouro: "Rua turmalina 34 São Mateus",
            numero: null,
            complemento: null,
            bairro: null,
            cidade: null,
            estado: null,
            cep: null,
            is_principal: true,
        });
        assert.ok(a);
        assert.equal(a?.numero, "34");
        assert.equal(a?.bairro, "São Mateus");
        assert.ok((a?.logradouro ?? "").toLowerCase().includes("turmalina"));
        assert.equal(a?.endereco_cliente_id, "addr-1");
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
});
