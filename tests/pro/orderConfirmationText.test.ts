import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isExplicitOrderConfirmation } from "../../src/pro/pipeline/orderConfirmationText";

describe("isExplicitOrderConfirmation", () => {
    it("aceita só ids de botão Confirmar (HITL)", () => {
        assert.equal(isExplicitOrderConfirmation("pro_confirm_order"), true);
        assert.equal(isExplicitOrderConfirmation("btn_confirm_order"), true);
        assert.equal(isExplicitOrderConfirmation("btn_confirmar"), true);
    });

    it("rejeita prosa afirmativa, inclusive a palavra solta 'confirmar' digitada (vai para o agent loop)", () => {
        assert.equal(isExplicitOrderConfirmation("sim"), false);
        assert.equal(isExplicitOrderConfirmation("OK!"), false);
        assert.equal(isExplicitOrderConfirmation("confirmar"), false);
        assert.equal(isExplicitOrderConfirmation("confirm_order"), false);
        assert.equal(isExplicitOrderConfirmation("confirmar_pedido"), false);
        assert.equal(isExplicitOrderConfirmation("pode confirmar"), false);
        assert.equal(isExplicitOrderConfirmation("sim pode confirmar"), false);
        assert.equal(isExplicitOrderConfirmation("ok obrigado"), false);
    });

    it("rejeita negação, cancelamento ou texto longo demais", () => {
        assert.equal(isExplicitOrderConfirmation("não"), false);
        assert.equal(isExplicitOrderConfirmation("cancelar"), false);
        assert.equal(isExplicitOrderConfirmation("a".repeat(97)), false);
    });
});
