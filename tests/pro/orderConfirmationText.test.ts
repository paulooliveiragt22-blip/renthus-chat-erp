import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    detectStructuredCheckoutAction,
    isExplicitOrderCancellation,
    isExplicitOrderConfirmation,
} from "../../src/pro/pipeline/orderConfirmationText";

describe("detectStructuredCheckoutAction (ADR-0005 C1)", () => {
    it("confirma só por IDs de botão", () => {
        assert.equal(detectStructuredCheckoutAction("pro_confirm_order"), "confirm");
        assert.equal(detectStructuredCheckoutAction("btn_confirm_order"), "confirm");
        assert.equal(detectStructuredCheckoutAction("btn_confirmar"), "confirm");
        assert.equal(isExplicitOrderConfirmation("pro_confirm_order"), true);
    });

    it("cancela só por IDs de botão", () => {
        assert.equal(detectStructuredCheckoutAction("pro_cancel_order"), "cancel");
        assert.equal(detectStructuredCheckoutAction("btn_cancel_order"), "cancel");
        assert.equal(isExplicitOrderCancellation("pro_cancel_order"), true);
    });

    it("prosa afirmativa/negativa NÃO fecha nem cancela (HITL e bot)", () => {
        for (const t of [
            "sim",
            "OK!",
            "okay",
            "confirmar",
            "CONFIRMAR",
            "1",
            "isso",
            "não",
            "nao",
            "cancelar",
            "2",
            "confirm_order",
            "confirmar_pedido",
            "pode confirmar",
            "sim pode confirmar",
            "ok obrigado",
        ]) {
            assert.equal(detectStructuredCheckoutAction(t), null, `esperava null para "${t}"`);
            assert.equal(isExplicitOrderConfirmation(t), false, t);
            assert.equal(isExplicitOrderCancellation(t), false, t);
        }
    });

    it("rejeita payload longo demais", () => {
        assert.equal(detectStructuredCheckoutAction("a".repeat(97)), null);
    });
});
