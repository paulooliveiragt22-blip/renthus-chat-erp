import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveFreeFormSendPolicy } from "@/src/domain/messaging/customerServiceWindow";

/**
 * Contrato inbox Meta: fora da 24h o humano usa HUMAN_AGENT;
 * sendMetaPageText deve receber messagingType MESSAGE_TAG (coberto em integração).
 */
describe("inbox Meta human send policy", () => {
    it("IG fora da janela → allowHumanAgentTag", () => {
        const now = Date.parse("2026-08-06T12:00:00.000Z");
        const p = resolveFreeFormSendPolicy({
            channel: "instagram",
            lastInboundAt: new Date(now - 30 * 3_600_000).toISOString(),
            nowMs: now,
        });
        assert.equal(p.allowAutomated, false);
        assert.equal(p.allowHumanAgentTag, true);
    });

    it("IG dentro da janela → RESPONSE (sem tag)", () => {
        const now = Date.parse("2026-08-06T12:00:00.000Z");
        const p = resolveFreeFormSendPolicy({
            channel: "instagram",
            lastInboundAt: new Date(now - 2 * 3_600_000).toISOString(),
            nowMs: now,
        });
        assert.equal(p.allowAutomated, true);
        assert.equal(p.allowHumanAgentTag, false);
    });
});
