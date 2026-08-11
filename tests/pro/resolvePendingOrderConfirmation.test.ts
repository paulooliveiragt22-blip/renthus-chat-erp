import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { detectPendingConfirmationIntent } from "../../src/pro/pipeline/resolvePendingOrderConfirmation";

describe("detectPendingConfirmationIntent", () => {
    it("reconhece variações de confirmação", () => {
        for (const t of ["confirmar", "Confirmo", "CONFIRMA", "confirmado", "isso", "sim", "ok", "Okay", "1"]) {
            assert.equal(detectPendingConfirmationIntent(t), "confirm", `esperava "confirm" para "${t}"`);
        }
    });

    it("reconhece variações de cancelamento", () => {
        for (const t of ["cancelar", "Cancela", "cancelado", "não", "nao", "2"]) {
            assert.equal(detectPendingConfirmationIntent(t), "cancel", `esperava "cancel" para "${t}"`);
        }
    });

    it("ignora respostas com prefixo/sufixo — precisa ser a mensagem toda", () => {
        assert.equal(detectPendingConfirmationIntent("confirmar por favor"), null);
        assert.equal(detectPendingConfirmationIntent("acho que sim, confirmar"), null);
    });

    it('não trata "s"/"n" isolados como confirmação/cancelamento (falso positivo perigoso)', () => {
        assert.equal(detectPendingConfirmationIntent("s"), null);
        assert.equal(detectPendingConfirmationIntent("n"), null);
        assert.equal(detectPendingConfirmationIntent("S"), null);
        assert.equal(detectPendingConfirmationIntent("N"), null);
    });

    it("ignora mensagens vazias, sem intenção ou de negócio (ex.: perguntas sobre o pedido)", () => {
        assert.equal(detectPendingConfirmationIntent(""), null);
        assert.equal(detectPendingConfirmationIntent("   "), null);
        assert.equal(detectPendingConfirmationIntent("quanto vai demorar?"), null);
        assert.equal(detectPendingConfirmationIntent("quero trocar o endereço"), null);
    });

    it("aceita pontuação/espaços nas bordas", () => {
        assert.equal(detectPendingConfirmationIntent("  confirmar!  "), "confirm");
        assert.equal(detectPendingConfirmationIntent("cancelar."), "cancel");
    });
});
