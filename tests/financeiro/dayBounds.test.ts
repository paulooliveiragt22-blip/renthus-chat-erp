import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    todayIsoInZone,
    zonedDayRange,
    zonedHour,
    zonedIsoDate,
    zonedLocalToUtc,
} from "../../lib/server/financeiro/dayBounds";

describe("dayBounds (M7)", () => {
    it("zonedIsoDate em America/Cuiaba", () => {
        // 2026-08-14 02:30 UTC = 2026-08-13 22:30 em Cuiabá (UTC-4)
        const d = new Date("2026-08-14T02:30:00.000Z");
        assert.equal(zonedIsoDate(d, "America/Cuiaba"), "2026-08-13");
    });

    it("zonedDayRange cobre o dia civil", () => {
        const { start, endExclusive } = zonedDayRange("2026-08-13", "America/Cuiaba");
        assert.equal(zonedIsoDate(start, "America/Cuiaba"), "2026-08-13");
        assert.equal(zonedIsoDate(new Date(endExclusive.getTime() - 1), "America/Cuiaba"), "2026-08-13");
        assert.equal(zonedIsoDate(endExclusive, "America/Cuiaba"), "2026-08-14");
        assert.ok(start.getTime() < endExclusive.getTime());
    });

    it("zonedLocalToUtc meia-noite", () => {
        const midnight = zonedLocalToUtc("2026-08-13", 0, 0, 0, "America/Cuiaba");
        assert.equal(zonedHour(midnight, "America/Cuiaba"), 0);
        assert.equal(todayIsoInZone(midnight, "America/Cuiaba"), "2026-08-13");
    });
});
