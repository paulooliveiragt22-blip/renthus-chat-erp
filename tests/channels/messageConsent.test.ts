import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    detectConsentIntent,
    normalizeConsentKeyword,
} from "@/lib/channels/messageConsentKeywords";

describe("messageConsent keywords", () => {
    it("normaliza acentos e espaços", () => {
        assert.equal(normalizeConsentKeyword("  PARAR  "), "parar");
        assert.equal(normalizeConsentKeyword("Quero Promoções"), "quero promocoes");
    });

    it("detecta opt-out", () => {
        assert.equal(detectConsentIntent("PARAR"), "opt_out");
        assert.equal(detectConsentIntent("sair"), "opt_out");
        assert.equal(detectConsentIntent("STOP"), "opt_out");
    });

    it("detecta opt-in", () => {
        assert.equal(detectConsentIntent("QUERO OFERTAS"), "opt_in");
        assert.equal(detectConsentIntent("quero promoções"), "opt_in");
    });

    it("ignora texto comum", () => {
        assert.equal(detectConsentIntent("quero um pedido"), null);
        assert.equal(detectConsentIntent("olá"), null);
    });
});
