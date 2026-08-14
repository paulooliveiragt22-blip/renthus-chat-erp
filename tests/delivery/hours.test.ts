import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildStoreClosedCustomerMessage,
    isStoreOpen,
    normalizeHhMm,
    normalizeTimezone,
    sanitizeDeliveryDescription,
    storeHoursFromRow,
} from "../../lib/delivery/hours";

describe("store hours (M2)", () => {
    it("normalizeHhMm aceita e rejeita", () => {
        assert.equal(normalizeHhMm("8:00"), "08:00");
        assert.equal(normalizeHhMm("23:59"), "23:59");
        assert.equal(normalizeHhMm("25:00"), null);
        assert.equal(normalizeHhMm(""), null);
    });

    it("normalizeTimezone cai no default se inválido", () => {
        assert.equal(normalizeTimezone("America/Cuiaba"), "America/Cuiaba");
        assert.equal(normalizeTimezone("Nao/Existe"), "America/Cuiaba");
    });

    it("sanitizeDeliveryDescription corta em 280", () => {
        assert.equal(sanitizeDeliveryDescription("  oi  "), "oi");
        assert.equal(sanitizeDeliveryDescription("x".repeat(300))?.length, 280);
    });

    it("isStoreOpen — sem horário cadastrado fica aberto", () => {
        const hours = storeHoursFromRow(null);
        assert.equal(isStoreOpen(Date.now(), hours), true);
    });

    it("isStoreOpen — janela diurna", () => {
        const hours = storeHoursFromRow({
            open_time: "08:00",
            close_time: "22:00",
            timezone: "America/Cuiaba",
        });
        // 2026-08-13 15:00 UTC-4 ≈ 15:00 Cuiaba (UTC-4)
        const afternoon = Date.parse("2026-08-13T19:00:00.000Z"); // 15:00 Cuiaba
        const night = Date.parse("2026-08-14T06:00:00.000Z"); // 02:00 Cuiaba
        assert.equal(isStoreOpen(afternoon, hours), true);
        assert.equal(isStoreOpen(night, hours), false);
    });

    it("isStoreOpen — overnight", () => {
        const hours = storeHoursFromRow({
            open_time: "18:00",
            close_time: "02:00",
            timezone: "America/Cuiaba",
        });
        const elevenPm = Date.parse("2026-08-14T03:00:00.000Z"); // 23:00 Cuiaba
        const oneAm = Date.parse("2026-08-14T05:00:00.000Z"); // 01:00 Cuiaba
        const noon = Date.parse("2026-08-13T16:00:00.000Z"); // 12:00 Cuiaba
        assert.equal(isStoreOpen(elevenPm, hours), true);
        assert.equal(isStoreOpen(oneAm, hours), true);
        assert.equal(isStoreOpen(noon, hours), false);
    });

    it("mensagem de fechado — hoje vs amanhã", () => {
        const hours = storeHoursFromRow({
            open_time: "09:00",
            close_time: "21:00",
            timezone: "America/Cuiaba",
        });
        const beforeOpen = Date.parse("2026-08-13T12:00:00.000Z"); // 08:00 Cuiaba
        const afterClose = Date.parse("2026-08-14T02:00:00.000Z"); // 22:00 Cuiaba
        const msgToday = buildStoreClosedCustomerMessage(hours, beforeOpen);
        assert.match(msgToday, /não estamos atendendo/i);
        assert.match(msgToday, /hoje a partir das 09:00/i);
        const msgTomorrow = buildStoreClosedCustomerMessage(hours, afterClose);
        assert.match(msgTomorrow, /amanhã a partir das 09:00/i);
    });

    it("isStoreOpen — dois turnos (almoço + jantar)", () => {
        const hours = storeHoursFromRow({
            opening_periods: [
                { open: "11:00", close: "14:30" },
                { open: "18:00", close: "23:00" },
            ],
            timezone: "America/Cuiaba",
        });
        const lunch = Date.parse("2026-08-13T16:00:00.000Z"); // 12:00 Cuiaba
        const afternoon = Date.parse("2026-08-13T20:00:00.000Z"); // 16:00 Cuiaba
        const dinner = Date.parse("2026-08-14T00:00:00.000Z"); // 20:00 Cuiaba
        assert.equal(isStoreOpen(lunch, hours), true);
        assert.equal(isStoreOpen(afternoon, hours), false);
        assert.equal(isStoreOpen(dinner, hours), true);
        const gapMsg = buildStoreClosedCustomerMessage(hours, afternoon);
        assert.match(gapMsg, /hoje a partir das 18:00/);
    });

    it("mensagem de fechado após o último turno — amanhã", () => {
        const hours = storeHoursFromRow({
            opening_periods: [
                { open: "11:00", close: "14:30" },
                { open: "18:00", close: "23:00" },
            ],
            timezone: "America/Cuiaba",
        });
        const afterDinner = Date.parse("2026-08-14T03:30:00.000Z"); // 23:30 Cuiaba
        const msg = buildStoreClosedCustomerMessage(hours, afterDinner);
        assert.match(msg, /amanhã a partir das 11:00/);
    });
});
