import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveInboundFromSnapshots } from "../../lib/billing/canProcessInboundChannel";

const NOW = new Date("2026-08-28T12:00:00.000Z");

describe("resolveInboundFromSnapshots", () => {
    it("company inactive → deny", () => {
        const r = resolveInboundFromSnapshots(false, {
            status: "active",
            trial_ends_at: null,
            last_paid_at: "2026-08-01T00:00:00.000Z",
            plan: "pro",
        }, NOW);
        assert.equal(r.allowed, false);
        if (!r.allowed) assert.equal(r.reason, "company_inactive");
    });

    it("pending_payment → deny mesmo com is_active true (defense)", () => {
        const r = resolveInboundFromSnapshots(true, {
            status: "pending_payment",
            trial_ends_at: NOW.toISOString(),
            last_paid_at: null,
            plan: "essencial",
        }, NOW);
        assert.equal(r.allowed, false);
        if (!r.allowed) assert.equal(r.reason, "pending_payment");
    });

    it("trial válido → allow", () => {
        const r = resolveInboundFromSnapshots(true, {
            status: "trial",
            trial_ends_at: "2026-09-01T00:00:00.000Z",
            last_paid_at: null,
            plan: "pro",
        }, NOW);
        assert.equal(r.allowed, true);
    });

    it("trial expirado → deny", () => {
        const r = resolveInboundFromSnapshots(true, {
            status: "trial",
            trial_ends_at: "2026-08-01T00:00:00.000Z",
            last_paid_at: null,
            plan: "pro",
        }, NOW);
        assert.equal(r.allowed, false);
        if (!r.allowed) assert.equal(r.reason, "trial_expired");
    });

    it("active pago → allow", () => {
        const r = resolveInboundFromSnapshots(true, {
            status: "active",
            trial_ends_at: null,
            last_paid_at: "2026-08-01T00:00:00.000Z",
            plan: "market",
        }, NOW);
        assert.equal(r.allowed, true);
    });
});
