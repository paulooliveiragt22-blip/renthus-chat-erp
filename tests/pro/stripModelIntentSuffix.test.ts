import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripModelIntentSuffix } from "../../src/pro/adapters/ai/stripModelIntentSuffix";

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
