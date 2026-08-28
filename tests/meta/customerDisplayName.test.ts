import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    fallbackMetaThreadProfileName,
    isGenericCustomerDisplayName,
    shouldUpdateThreadProfileName,
} from "../../lib/meta/customerDisplayName";

describe("customerDisplayName", () => {
    it("detecta nomes genéricos", () => {
        assert.equal(isGenericCustomerDisplayName("Cliente"), true);
        assert.equal(isGenericCustomerDisplayName("Cliente Instagram"), true);
        assert.equal(isGenericCustomerDisplayName("Maria Silva"), false);
    });

    it("fallback por canal", () => {
        assert.equal(fallbackMetaThreadProfileName("instagram"), "Cliente Instagram");
        assert.equal(fallbackMetaThreadProfileName("messenger"), "Cliente Messenger");
    });

    it("não sobrescreve nome real com placeholder", () => {
        assert.equal(
            shouldUpdateThreadProfileName("Maria Silva", "Cliente Instagram"),
            false
        );
        assert.equal(
            shouldUpdateThreadProfileName("Cliente Instagram", "Maria Silva"),
            true
        );
        assert.equal(shouldUpdateThreadProfileName(null, "Maria Silva"), true);
    });
});
