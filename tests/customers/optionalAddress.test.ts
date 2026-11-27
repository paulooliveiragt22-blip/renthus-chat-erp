import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { optionalCustomerAddress } from "../../lib/customers/optionalAddress";

describe("endereço opcional do cliente", () => {
    it("grava o cliente sem endereço", () => {
        assert.deepEqual(optionalCustomerAddress(null), { ok: true, address: null });
        assert.deepEqual(
            optionalCustomerAddress({ logradouro: "  ", numero: "", bairro: "", cidade: "", estado: "" }),
            { ok: true, address: null }
        );
    });

    it("recusa endereço pela metade", () => {
        assert.deepEqual(
            optionalCustomerAddress({ logradouro: "Rua A", numero: "10", bairro: "", cidade: "", estado: "" }),
            { ok: false, error: "address_incomplete" }
        );
    });

    it("aceita o núcleo de entrega", () => {
        const result = optionalCustomerAddress({
            logradouro: "Rua A",
            numero: "10",
            bairro: "Centro",
            cidade: "Cuiabá",
            estado: "mt",
        });
        assert.equal(result.ok, true);
        if (result.ok && result.address) assert.equal(result.address.estado, "MT");
    });
});
