import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    filterFreeSlots,
    googleEventBody,
    googleScopesGranted,
    rangeHitsBusy,
} from "../../src/service/domain/googleCalendar";
import { createGoogleOAuthState, parseGoogleOAuthState } from "../../src/service/adapters/google/googleOAuthState";

const SLOT = "2026-11-27T14:00:00.000Z";
const LATER = "2026-11-27T15:00:00.000Z";

describe("agenda do Google", () => {
    it("tira o horário que encosta no ocupado e mantém o seguinte", () => {
        const busy = [{ start: "2026-11-27T14:00:00.000Z", end: "2026-11-27T15:00:00.000Z" }];
        assert.deepEqual(filterFreeSlots([SLOT, LATER], 60, busy), [LATER]);
        assert.equal(rangeHitsBusy(SLOT, LATER, busy), true);
        assert.equal(rangeHitsBusy(LATER, "2026-11-27T16:00:00.000Z", busy), false);
    });

    it("ignora o próprio horário na remarcação e barra o que está ao lado", () => {
        const own = { start: SLOT, end: LATER };
        const merged = [{ start: SLOT, end: "2026-11-27T16:00:00.000Z" }];
        assert.equal(rangeHitsBusy("2026-11-27T13:00:00.000Z", SLOT, merged, own), false);
        assert.equal(rangeHitsBusy(LATER, "2026-11-27T16:00:00.000Z", merged, own), true);
    });

    it("o evento leva o serviço e o nome, sem telefone", () => {
        const body = googleEventBody({
            offeringName: "Corte",
            customerName: "Ana",
            startsAt: SLOT,
            endsAt: LATER,
            timeZone: "America/Cuiaba",
        });
        assert.equal(body.summary, "Corte — Ana");
        assert.equal(
            googleEventBody({
                offeringName: "Corte",
                customerName: "Ana",
                label: "Visita para orçamento",
                startsAt: SLOT,
                endsAt: LATER,
                timeZone: "America/Cuiaba",
            }).summary,
            "Visita para orçamento — Ana"
        );
        assert.equal(JSON.stringify(body).includes("5565"), false);
        assert.equal(
            googleScopesGranted("openid email https://www.googleapis.com/auth/calendar.events"),
            false
        );
        assert.equal(
            googleScopesGranted(
                "email https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events"
            ),
            true
        );
    });

    it("o state da conexão só abre para a mesma empresa e a mesma pessoa", () => {
        process.env.CREDENTIALS_ENCRYPTION_KEY =
            process.env.CREDENTIALS_ENCRYPTION_KEY || "test-signing-secret-for-oauth-state";
        const state = createGoogleOAuthState(
            "11111111-1111-4111-8111-111111111111",
            "22222222-2222-4222-8222-222222222222"
        );
        const parsed = parseGoogleOAuthState(state);
        assert.equal(parsed?.companyId, "11111111-1111-4111-8111-111111111111");
        assert.equal(parsed?.userId, "22222222-2222-4222-8222-222222222222");
        assert.equal(parseGoogleOAuthState(`${state}x`), null);
    });
});
