import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    resolveCheckoutChannel,
    shouldOfferWebAddressHandoff,
} from "../../src/pro/pipeline/checkoutChannelPolicy";

describe("resolveCheckoutChannel (ADR-0005 R1–R2 / C1b)", () => {
    const base = {
        hasItems: true,
        fulfillmentType: "delivery" as const,
        addressStructurallyComplete: false,
        requiresAddressRegistration: false,
        intentNewAddress: false,
    };

    it("sem itens → whatsapp", () => {
        const d = resolveCheckoutChannel({ ...base, hasItems: false });
        assert.equal(d.channel, "whatsapp");
        assert.equal(d.reason, "no_items");
        assert.equal(shouldOfferWebAddressHandoff(d), false);
    });

    it("sem fulfillment → WA (botões Entrega/Retirada)", () => {
        const d = resolveCheckoutChannel({ ...base, fulfillmentType: null });
        assert.equal(d.channel, "whatsapp");
        assert.equal(d.reason, "awaiting_fulfillment");
    });

    it("pickup → sempre WA (sem handoff de endereço)", () => {
        const d = resolveCheckoutChannel({
            ...base,
            fulfillmentType: "pickup",
            requiresAddressRegistration: true,
            intentNewAddress: true,
        });
        assert.equal(d.channel, "whatsapp");
        assert.equal(d.reason, "pickup");
        assert.equal(shouldOfferWebAddressHandoff(d), false);
    });

    it("delivery + sem cadastro → web_menu", () => {
        const d = resolveCheckoutChannel({
            ...base,
            requiresAddressRegistration: true,
            hasIncompleteSavedAddress: false,
        });
        assert.deepEqual(d, { channel: "web_menu", reason: "no_saved_address" });
        assert.equal(shouldOfferWebAddressHandoff(d), true);
    });

    it("delivery + cadastro incompleto → web_menu", () => {
        const d = resolveCheckoutChannel({
            ...base,
            requiresAddressRegistration: true,
            hasIncompleteSavedAddress: true,
        });
        assert.deepEqual(d, { channel: "web_menu", reason: "incomplete_saved_address" });
    });

    it("delivery + outro endereço → web_menu", () => {
        const d = resolveCheckoutChannel({
            ...base,
            requiresAddressRegistration: false,
            intentNewAddress: true,
        });
        assert.deepEqual(d, { channel: "web_menu", reason: "new_address_requested" });
    });

    it("delivery + endereços salvos ok (ainda sem draft) → WA default", () => {
        const d = resolveCheckoutChannel({
            ...base,
            requiresAddressRegistration: false,
            addressStructurallyComplete: false,
        });
        assert.equal(d.channel, "whatsapp");
        assert.equal(d.reason, "saved_address_ok");
    });

    it("delivery + endereço completo no draft → WA", () => {
        const d = resolveCheckoutChannel({
            ...base,
            addressStructurallyComplete: true,
            requiresAddressRegistration: false,
        });
        assert.equal(d.channel, "whatsapp");
        assert.equal(d.reason, "address_complete_on_wa");
    });
});
