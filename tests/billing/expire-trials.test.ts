/**
 * Testes unitários para a lógica de expire-trials.
 * Apenas a função de query (pura) — o route handler completo requer Supabase real.
 */

import assert from "node:assert";
import { describe, it } from "node:test";

const NOW = new Date("2026-08-28T12:00:00.000Z");

/** Simula a lógica de expiração de trial. */
function resolveTrialExpiration(sub: {
    status: string;
    trial_ends_at: string | null;
    plan: string | null;
}, now: Date = NOW): { expired: boolean; nextStatus: string | null } {
    if (sub.status !== "trial") {
        return { expired: false, nextStatus: null };
    }
    if (!sub.trial_ends_at) {
        return { expired: false, nextStatus: null };
    }
    const ends = new Date(sub.trial_ends_at);
    if (!Number.isFinite(ends.getTime())) {
        return { expired: false, nextStatus: null };
    }
    if (ends.getTime() > now.getTime()) {
        return { expired: false, nextStatus: null };
    }
    // Trial vencido
    const hasPlanChoice = sub.plan != null && String(sub.plan).trim() !== "";
    const nextStatus = hasPlanChoice ? "pending_payment" : "pending_setup";
    return { expired: true, nextStatus };
}

describe("resolveTrialExpiration", () => {
    it("trial com trial_ends_at no futuro → não expira", () => {
        const r = resolveTrialExpiration({
            status: "trial",
            trial_ends_at: "2026-09-01T00:00:00.000Z",
            plan: "pro",
        }, NOW);
        assert.equal(r.expired, false);
    });

    it("trial com trial_ends_at no passado → expira", () => {
        const r = resolveTrialExpiration({
            status: "trial",
            trial_ends_at: "2026-08-01T00:00:00.000Z",
            plan: "pro",
        }, NOW);
        assert.equal(r.expired, true);
        assert.equal(r.nextStatus, "pending_payment");
    });

    it("trial vencido com plano → nextStatus = pending_payment", () => {
        const r = resolveTrialExpiration({
            status: "trial",
            trial_ends_at: "2026-08-20T00:00:00.000Z",
            plan: "essencial",
        }, NOW);
        assert.equal(r.expired, true);
        assert.equal(r.nextStatus, "pending_payment");
    });

    it("trial vencido sem plano → nextStatus = pending_setup", () => {
        const r = resolveTrialExpiration({
            status: "trial",
            trial_ends_at: "2026-08-20T00:00:00.000Z",
            plan: null,
        }, NOW);
        assert.equal(r.expired, true);
        assert.equal(r.nextStatus, "pending_setup");
    });

    it("trial vencido com plano vazio → nextStatus = pending_setup", () => {
        const r = resolveTrialExpiration({
            status: "trial",
            trial_ends_at: "2026-08-20T00:00:00.000Z",
            plan: "  ",
        }, NOW);
        assert.equal(r.expired, true);
        assert.equal(r.nextStatus, "pending_setup");
    });

    it("trial sem trial_ends_at → não expira (edge case)", () => {
        const r = resolveTrialExpiration({
            status: "trial",
            trial_ends_at: null,
            plan: "pro",
        }, NOW);
        assert.equal(r.expired, false);
    });

    it("status não é trial → não expira", () => {
        const r = resolveTrialExpiration({
            status: "active",
            trial_ends_at: "2026-08-01T00:00:00.000Z",
            plan: "pro",
        }, NOW);
        assert.equal(r.expired, false);
    });
});
