import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildStoreHoursFaqReply,
    looksLikeStoreHoursQuestion,
} from "../../src/pro/pipeline/storeHoursFaq";
import { looksLikeOrderStatusQuestion } from "../../src/pro/pipeline/orderStatusFaq";
import type { StoreHours } from "../../lib/delivery/hours";

describe("storeHoursFaq", () => {
    it("detecta perguntas de horário", () => {
        assert.equal(looksLikeStoreHoursQuestion("que horas vocês abrem?"), true);
        assert.equal(looksLikeStoreHoursQuestion("qual o horário de atendimento"), true);
        assert.equal(looksLikeStoreHoursQuestion("quero uma coca"), false);
    });

    it("responde com label quando há turnos", () => {
        const hours: StoreHours = {
            periods: [{ openTime: "08:00", closeTime: "18:00" }],
            openTime: "08:00",
            closeTime: "18:00",
            timeZone: "America/Cuiaba",
            deliveryDescription: null,
        };
        const text = buildStoreHoursFaqReply(hours, Date.parse("2026-08-25T12:00:00-04:00"));
        assert.match(text, /08:00–18:00/);
    });
});

describe("orderStatusFaq", () => {
    it("detecta consulta de status", () => {
        assert.equal(looksLikeOrderStatusQuestion("onde está meu pedido"), true);
        assert.equal(looksLikeOrderStatusQuestion("btn_status"), true);
        assert.equal(looksLikeOrderStatusQuestion("quero skol"), false);
    });
});
