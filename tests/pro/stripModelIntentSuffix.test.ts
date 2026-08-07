import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    stripAddressFreeTextMarker,
    stripModelIntentSuffix,
} from "../../src/pro/adapters/ai/stripModelIntentSuffix";

describe("stripModelIntentSuffix", () => {
    it("remove INTENT_OK sem asterisco", () => {
        const r = stripModelIntentSuffix("Pedido quase pronto.\nINTENT_OK");
        assert.equal(r.marker, "ok");
        assert.equal(r.visible, "Pedido quase pronto.");
    });

    it("remove *INTENT_UNKNOWN* (formato visto no WhatsApp)", () => {
        const r = stripModelIntentSuffix("Escolha pagamento.\n*INTENT_UNKNOWN*");
        assert.equal(r.marker, "unknown");
        assert.equal(r.visible, "Escolha pagamento.");
    });

    it("remove INTENT_OK entre asteriscos", () => {
        const r = stripModelIntentSuffix("Ok *INTENT_OK*");
        assert.equal(r.marker, "ok");
        assert.equal(r.visible, "Ok");
    });

    it("sem marcador: inalterado e marker null", () => {
        const r = stripModelIntentSuffix("Só texto");
        assert.equal(r.marker, null);
        assert.equal(r.visible, "Só texto");
    });
});

describe("stripAddressFreeTextMarker", () => {
    it("remove ADDR_FREE_TEXT no final", () => {
        const r = stripAddressFreeTextMarker("Tenho Rua X, 1 cadastrado aqui...\nADDR_FREE_TEXT");
        assert.equal(r.addressFreeText, true);
        assert.equal(r.visible, "Tenho Rua X, 1 cadastrado aqui...");
    });

    it("sem marcador: inalterado e addressFreeText false", () => {
        const r = stripAddressFreeTextMarker("Só texto");
        assert.equal(r.addressFreeText, false);
        assert.equal(r.visible, "Só texto");
    });

    it("combinação com INTENT_OK (ADDR_FREE_TEXT primeiro) via duas passadas", () => {
        const raw = "Tenho Rua X, 1 cadastrado aqui. ADDR_FREE_TEXT INTENT_OK";
        const pass1 = stripAddressFreeTextMarker(raw);
        assert.equal(pass1.addressFreeText, false, "ADDR_FREE_TEXT não está mais no final antes de tirar INTENT_OK");
        const { visible, marker } = stripModelIntentSuffix(pass1.visible);
        assert.equal(marker, "ok");
        const pass2 = stripAddressFreeTextMarker(visible);
        assert.equal(pass2.addressFreeText, true);
        assert.equal(pass2.visible, "Tenho Rua X, 1 cadastrado aqui.");
    });
});
