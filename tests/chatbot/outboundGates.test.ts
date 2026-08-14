import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    evaluateOutboundGates,
    isWithinBusinessHours,
    type OutboundGateContext,
} from "../../lib/chatbot/outbound/gates";

/** 15:00 em São Paulo (UTC-3) — dentro de qualquer horário comercial típico. */
const NOW = Date.parse("2026-08-05T18:00:00.000Z");

function baseContext(overrides: Partial<OutboundGateContext> = {}): OutboundGateContext {
    return {
        purpose: "cart_recovery",
        nowMs: NOW,
        hasPayload: true,
        lastInboundAt: new Date(NOW - 30 * 60_000).toISOString(),
        botActive: true,
        cartStatus: "open",
        recentProactiveCount: 0,
        maxProactivePerWindow: 1,
        businessHours: { openTime: "08:00", closeTime: "23:00", timeZone: "America/Sao_Paulo" },
        ...overrides,
    };
}

describe("evaluateOutboundGates", () => {
    it("libera recuperação de carrinho no caminho feliz", () => {
        assert.deepEqual(evaluateOutboundGates(baseContext()), { allow: true });
    });

    it("bloqueia fora da janela de 24h", () => {
        const decision = evaluateOutboundGates(
            baseContext({ lastInboundAt: new Date(NOW - 30 * 3_600_000).toISOString() })
        );
        assert.deepEqual(decision, { allow: false, reason: "outside_service_window" });
    });

    it("bloqueia quando um humano assumiu a conversa", () => {
        assert.deepEqual(evaluateOutboundGates(baseContext({ botActive: false })), {
            allow: false,
            reason: "human_handover",
        });
    });

    it("bloqueia quando o carrinho já foi recuperado ou expirou", () => {
        for (const cartStatus of ["recovered", "expired", "discarded", null]) {
            assert.deepEqual(evaluateOutboundGates(baseContext({ cartStatus })), {
                allow: false,
                reason: "cart_not_open",
            });
        }
    });

    it("bloqueia payload vazio antes de qualquer outra checagem", () => {
        const decision = evaluateOutboundGates(
            baseContext({ hasPayload: false, botActive: false })
        );
        assert.deepEqual(decision, { allow: false, reason: "empty_payload" });
    });

    it("respeita o teto de frequência por cliente", () => {
        assert.deepEqual(evaluateOutboundGates(baseContext({ recentProactiveCount: 1 })), {
            allow: false,
            reason: "frequency_cap",
        });
    });

    it("bloqueia fora do horário da loja", () => {
        const decision = evaluateOutboundGates(
            baseContext({
                businessHours: { openTime: "08:00", closeTime: "12:00", timeZone: "America/Sao_Paulo" },
            })
        );
        assert.deepEqual(decision, { allow: false, reason: "outside_business_hours" });
    });

    it("transacional: libera fora do horário; ainda exige janela 24h Meta (envio real)", () => {
        const ctx = baseContext({
            purpose: "transactional",
            cartStatus: null,
            recentProactiveCount: 99,
            businessHours: { openTime: "08:00", closeTime: "09:00", timeZone: "America/Sao_Paulo" },
        });
        assert.deepEqual(evaluateOutboundGates(ctx), { allow: true });
        assert.deepEqual(
            evaluateOutboundGates({ ...ctx, lastInboundAt: null }),
            { allow: false, reason: "outside_service_window" }
        );
        // Handover humano também bloqueia o envio do "em preparo"
        assert.deepEqual(
            evaluateOutboundGates({ ...ctx, botActive: false }),
            { allow: false, reason: "human_handover" }
        );
    });
});

describe("isWithinBusinessHours", () => {
    const tz = "America/Sao_Paulo";

    it("sem horário configurado, evita madrugada", () => {
        const threeAm = Date.parse("2026-08-05T06:00:00.000Z");
        const twoPm = Date.parse("2026-08-05T17:00:00.000Z");
        assert.equal(isWithinBusinessHours(threeAm, { openTime: null, closeTime: null, timeZone: tz }), false);
        assert.equal(isWithinBusinessHours(twoPm, { openTime: null, closeTime: null, timeZone: tz }), true);
    });

    it("suporta janela que atravessa a meia-noite", () => {
        const hours = { openTime: "18:00", closeTime: "02:00", timeZone: tz };
        const elevenPm = Date.parse("2026-08-06T02:00:00.000Z");
        const oneAm = Date.parse("2026-08-06T04:00:00.000Z");
        const noon = Date.parse("2026-08-05T15:00:00.000Z");
        assert.equal(isWithinBusinessHours(elevenPm, hours), true);
        assert.equal(isWithinBusinessHours(oneAm, hours), true);
        assert.equal(isWithinBusinessHours(noon, hours), false);
    });

    it("fuso inválido não bloqueia envio", () => {
        assert.equal(
            isWithinBusinessHours(NOW, { openTime: "08:00", closeTime: "23:00", timeZone: "Nao/Existe" }),
            true
        );
    });
});
