import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isExplicitOrderConfirmation } from "../../src/pro/pipeline/orderConfirmationText";

describe("isExplicitOrderConfirmation", () => {
    it("aceita confirmações curtas (legado)", () => {
        assert.equal(isExplicitOrderConfirmation("sim"), true);
        assert.equal(isExplicitOrderConfirmation("OK!"), true);
        assert.equal(isExplicitOrderConfirmation("pode confirmar"), true);
        assert.equal(isExplicitOrderConfirmation("confirmar"), true);
    });

    it("aceita confirmação com cortesia ou complemento após o prefixo", () => {
        assert.equal(isExplicitOrderConfirmation("sim pode confirmar"), true);
        assert.equal(isExplicitOrderConfirmation("Sim, pode fechar o pedido por favor"), true);
        assert.equal(isExplicitOrderConfirmation("ok obrigado"), true);
        assert.equal(isExplicitOrderConfirmation("confirmo então"), true);
        assert.equal(isExplicitOrderConfirmation("quero confirmar"), true);
        assert.equal(isExplicitOrderConfirmation("confirmar o pedido"), true);
    });

    it("rejeita negação, cancelamento ou texto longo demais", () => {
        assert.equal(isExplicitOrderConfirmation("não"), false);
        assert.equal(isExplicitOrderConfirmation("sim não"), false);
        assert.equal(isExplicitOrderConfirmation("cancelar"), false);
        assert.equal(isExplicitOrderConfirmation("desisto"), false);
        assert.equal(isExplicitOrderConfirmation("a".repeat(97)), false);
    });

    it("aceita ids de botão normalizados", () => {
        assert.equal(isExplicitOrderConfirmation("pro_confirm_order"), true);
    });
});
