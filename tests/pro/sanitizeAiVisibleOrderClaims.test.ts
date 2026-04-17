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

    it("substitui afirmacao de pedido criado (IA sem RPC)", () => {
        const out = stripHallucinatedOrderPersistenceClaims(
            "Pronto! Seu pedido foi criado e ja esta no sistema."
        );
        assert.match(out, /Ainda nao registrei seu pedido/i);
        assert.doesNotMatch(out, /pedido foi criado/i);
    });

    it("substitui criamos seu pedido", () => {
        const out = stripHallucinatedOrderPersistenceClaims("Criamos seu pedido com sucesso!");
        assert.match(out, /Ainda nao registrei seu pedido/i);
    });

    it("substitui seu pedido JA foi confirmado (caso real WhatsApp)", () => {
        const out = stripHallucinatedOrderPersistenceClaims(
            "Seu pedido já foi confirmado! ✅\n\n**Resumo final:**\n- 1 caixa..."
        );
        assert.match(out, /Ainda nao registrei seu pedido/i);
        assert.doesNotMatch(out, /confirmado!/i);
    });

    it("substitui titulo markdown Pedido confirmado:", () => {
        const out = stripHallucinatedOrderPersistenceClaims(
            "✅ **Pedido confirmado:**\n- 1 caixa de CERVEJA ORIGINAL"
        );
        assert.match(out, /Ainda nao registrei seu pedido/i);
    });

    it("substitui confirmado aqui comigo", () => {
        const out = stripHallucinatedOrderPersistenceClaims(
            "Seu pedido foi **confirmado aqui comigo**, mas a criação no servidor..."
        );
        assert.match(out, /Ainda nao registrei seu pedido/i);
    });
});
