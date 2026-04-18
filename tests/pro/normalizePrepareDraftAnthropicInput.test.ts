import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePrepareDraftAnthropicInput } from "../../lib/chatbot/pro/normalizePrepareDraftAnthropicInput";

describe("normalizePrepareDraftAnthropicInput", () => {
    it("mapeia produtoEmbalagemId e paymentMethod em camelCase", () => {
        const out = normalizePrepareDraftAnthropicInput({
            items: [{ produtoEmbalagemId: "a3806337-4700-4e77-a788-6bcfa181c100", quantity: 1 }],
            paymentMethod: "cartao",
            addressRaw: "rua tangara 850 sao mateus",
        });
        assert.equal(out.items[0]?.produto_embalagem_id, "a3806337-4700-4e77-a788-6bcfa181c100");
        assert.equal(out.payment_method, "cartao");
        assert.equal(out.address_raw, "rua tangara 850 sao mateus");
    });

    it("aceita address com street/number/neighborhood", () => {
        const out = normalizePrepareDraftAnthropicInput({
            items: [{ produto_embalagem_id: "x", quantity: 2 }],
            address: { street: "Rua A", number: "1", neighborhood: "Centro" },
        });
        assert.equal(out.address?.logradouro, "Rua A");
        assert.equal(out.address?.numero, "1");
        assert.equal(out.address?.bairro, "Centro");
    });

    it("mapeia id (como no JSON de search_produtos) para produto_embalagem_id", () => {
        const out = normalizePrepareDraftAnthropicInput({
            items: [{ id: "a3806337-4700-4e77-a788-6bcfa181c100", quantity: 1 }],
            paymentMethod: "cartao",
        });
        assert.equal(out.items[0]?.produto_embalagem_id, "a3806337-4700-4e77-a788-6bcfa181c100");
    });
});
