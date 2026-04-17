import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripHallucinatedOrderPersistenceClaims } from "../../src/pro/adapters/ai/sanitizeAiVisibleOrderClaims";

describe("stripHallucinatedOrderPersistenceClaims", () => {
    it("substitui texto de pedido ja confirmado no sistema", () => {
        const out = stripHallucinatedOrderPersistenceClaims(
            "Perfeito!\n\nSeu pedido foi confirmado:\n🍺 1x Heineken"
        );
        assert.match(out, /Ainda nao registrei seu pedido/i);
        assert.doesNotMatch(out, /pedido foi confirmado/i);
    });

    it("substitui saida para entrega", () => {
        const out = stripHallucinatedOrderPersistenceClaims("Seu pedido saiu pra entrega! Obrigado.");
        assert.match(out, /Ainda nao registrei seu pedido/i);
    });

    it("nao altera convite a confirmar", () => {
        const t = "Pronto para confirmar? Revise o resumo acima.";
        assert.equal(stripHallucinatedOrderPersistenceClaims(t), t);
    });
});
