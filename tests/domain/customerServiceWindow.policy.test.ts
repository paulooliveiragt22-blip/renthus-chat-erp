import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    isWithinCustomerServiceWindow,
    resolveFreeFormSendPolicy,
} from "@/src/domain/messaging/customerServiceWindow";

const NOW = Date.parse("2026-08-06T12:00:00.000Z");

function hoursAgoIso(h: number): string {
    return new Date(NOW - h * 3_600_000).toISOString();
}

describe("resolveFreeFormSendPolicy (B4)", () => {
    it("permite bot dentro da janela em qualquer canal", () => {
        const p = resolveFreeFormSendPolicy({
            channel: "instagram",
            lastInboundAt: hoursAgoIso(2),
            nowMs: NOW,
        });
        assert.equal(p.allowAutomated, true);
        assert.equal(p.reason, "within_window");
    });

    it("IG fora da janela: bot silencia; humano pode usar tag", () => {
        const p = resolveFreeFormSendPolicy({
            channel: "instagram",
            lastInboundAt: hoursAgoIso(25),
            nowMs: NOW,
        });
        assert.equal(p.allowAutomated, false);
        assert.equal(p.allowHumanAgentTag, true);
        assert.equal(p.reason, "outside_window");
    });

    it("WhatsApp fora da janela: bot silencia free-form", () => {
        assert.equal(isWithinCustomerServiceWindow(hoursAgoIso(25), NOW), false);
        const p = resolveFreeFormSendPolicy({
            channel: "whatsapp",
            lastInboundAt: hoursAgoIso(25),
            nowMs: NOW,
        });
        assert.equal(p.allowAutomated, false);
        assert.equal(p.allowHumanAgentTag, false);
    });
});
