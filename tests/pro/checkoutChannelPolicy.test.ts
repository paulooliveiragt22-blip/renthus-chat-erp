import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    checkoutChannelInputFromState,
    isNewAddressCheckoutAction,
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

    it("C1.5: completo + incompletos nos hints → registration false → WA (não web)", () => {
        const input = checkoutChannelInputFromState({
            draft: {
                items: [{ produtoEmbalagemId: "x" }],
                fulfillmentType: "delivery",
                address: null,
            } as never,
            orderHints: {
                requires_address_flow_registration: false,
                saved_addresses_incomplete: [{ id: "bad", reason_pt: "sem UF" }],
            },
            intentNewAddress: false,
        });
        assert.equal(input.requiresAddressRegistration, false);
        assert.equal(input.hasIncompleteSavedAddress, true);
        const d = resolveCheckoutChannel(input);
        assert.equal(d.channel, "whatsapp");
        assert.equal(d.reason, "saved_address_ok");
        assert.equal(shouldOfferWebAddressHandoff(d), false);
    });

    it("isNewAddressCheckoutAction reconhece botões R2", () => {
        assert.equal(isNewAddressCheckoutAction("pro_new_address_flow"), true);
        assert.equal(isNewAddressCheckoutAction("pro_edit_delivery_address"), true);
        assert.equal(isNewAddressCheckoutAction("pro_confirm_order"), false);
    });
});
