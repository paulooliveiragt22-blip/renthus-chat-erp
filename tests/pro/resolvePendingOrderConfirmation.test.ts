import assert from "node:assert/strict";
import { describe, it } from "node:test";
/**
 * HITL usa o mesmo contrato que o bot (`detectStructuredCheckoutAction`).
 * Este ficheiro cobre o contrato do interceptor sem importar o módulo
 * `resolvePendingOrderConfirmation` (puxa adapters/server-only).
 */
import { detectStructuredCheckoutAction } from "../../src/pro/pipeline/orderConfirmationText";

/** Espelha `detectPendingConfirmationIntent` (re-export no interceptor). */
function detectPendingConfirmationIntent(text: string) {
    return detectStructuredCheckoutAction(text);
}

describe("HITL pending confirmation intent (ADR-0005 C1)", () => {
    it("reconhece só botões de confirmação", () => {
        for (const t of ["pro_confirm_order", "btn_confirm_order", "btn_confirmar"]) {
            assert.equal(detectPendingConfirmationIntent(t), "confirm", t);
        }
    });

    it("reconhece só botões de cancelamento", () => {
        for (const t of ["pro_cancel_order", "btn_cancel_order"]) {
            assert.equal(detectPendingConfirmationIntent(t), "cancel", t);
        }
    });

    it("ignora prosa que antes fechava pedido (sim/ok/CONFIRMAR/1)", () => {
        for (const t of [
            "confirmar",
            "Confirmo",
            "CONFIRMA",
            "confirmado",
            "isso",
            "sim",
            "ok",
            "Okay",
            "1",
            "  confirmar!  ",
        ]) {
            assert.equal(detectPendingConfirmationIntent(t), null, `não deve confirmar: "${t}"`);
        }
    });

    it("ignora prosa de cancelamento legada", () => {
        for (const t of ["cancelar", "Cancela", "cancelado", "não", "nao", "2", "cancelar."]) {
            assert.equal(detectPendingConfirmationIntent(t), null, `não deve cancelar: "${t}"`);
        }
    });
});
