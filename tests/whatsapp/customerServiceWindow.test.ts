import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    hoursSinceLastInbound,
    isCustomerServiceWindowClosing,
    isWithinCustomerServiceWindow,
} from "../../lib/whatsapp/customerServiceWindow";

const NOW = Date.parse("2026-08-05T12:00:00.000Z");

function hoursAgoIso(hours: number): string {
    return new Date(NOW - hours * 3_600_000).toISOString();
}

describe("customerServiceWindow", () => {
    it("conta as horas desde o último inbound", () => {
        assert.equal(hoursSinceLastInbound(hoursAgoIso(3), NOW), 3);
    });

    it("sem inbound registado, não há janela aberta", () => {
        assert.equal(hoursSinceLastInbound(null, NOW), null);
        assert.equal(isWithinCustomerServiceWindow(null, NOW), false);
        assert.equal(isWithinCustomerServiceWindow("", NOW), false);
    });

    it("data inválida não abre a janela", () => {
        assert.equal(isWithinCustomerServiceWindow("nao-e-data", NOW), false);
    });

    it("abre dentro de 24h e fecha depois", () => {
        assert.equal(isWithinCustomerServiceWindow(hoursAgoIso(0.5), NOW), true);
        assert.equal(isWithinCustomerServiceWindow(hoursAgoIso(23.9), NOW), true);
        assert.equal(isWithinCustomerServiceWindow(hoursAgoIso(24), NOW), false);
        assert.equal(isWithinCustomerServiceWindow(hoursAgoIso(48), NOW), false);
    });

    it("sinaliza janela perto de fechar apenas entre 20h e 24h", () => {
        assert.equal(isCustomerServiceWindowClosing(hoursAgoIso(19), NOW), false);
        assert.equal(isCustomerServiceWindowClosing(hoursAgoIso(21), NOW), true);
        assert.equal(isCustomerServiceWindowClosing(hoursAgoIso(25), NOW), false);
    });
});
