import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { yearlySavingsPercent } from "../../../lib/billing/yearlyFromDiscount";
import {
    ATTENDANCE_FEATURES,
    ATTENDANCE_MONTHLY_CENTS,
    ATTENDANCE_YEARLY_CENTS,
    ATTENDANCE_YEARLY_PER_MONTH_CENTS,
    attendanceTalkHref,
    attendanceYearlySavingsPercent,
} from "../../../lib/marketing/attendanceOffer";

describe("oferta pública de atendimento", () => {
    it("mostra 159 no mês e 99,90 por mês no ano", () => {
        assert.equal(ATTENDANCE_MONTHLY_CENTS, 15_900);
        assert.equal(ATTENDANCE_YEARLY_PER_MONTH_CENTS, 9_990);
        assert.equal(ATTENDANCE_YEARLY_CENTS, 9_990 * 12);
        assert.equal(
            attendanceYearlySavingsPercent(),
            yearlySavingsPercent(ATTENDANCE_MONTHLY_CENTS, ATTENDANCE_YEARLY_CENTS)
        );
        assert.equal(attendanceYearlySavingsPercent(), 37);
    });

    it("não vende chat do site e manda o anual pro WhatsApp", () => {
        const labels = ATTENDANCE_FEATURES.map((feature) => feature.label.toLowerCase());
        assert.equal(labels.some((label) => label.includes("site")), false);
        const href = attendanceTalkHref("year");
        assert.match(href, /^https:\/\/wa\.me\/556692071285\?text=/);
        assert.match(decodeURIComponent(href), /99,90/);
    });
});
