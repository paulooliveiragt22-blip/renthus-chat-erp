import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    gateFeaturesByAccess,
    resolveTenantAccess,
} from "../../lib/billing/tenantAccess";

const NOW = new Date("2026-08-28T12:00:00.000Z");

describe("resolveTenantAccess", () => {
    it("missing → deny", () => {
        const t = resolveTenantAccess(null, NOW);
        assert.equal(t.access, "deny");
        assert.equal(t.reason, "missing");
        assert.equal(t.featuresEligible, false);
        assert.equal(t.plan_intent, null);
    });

    it("pending_payment → deny, plan_intent preservado", () => {
        const t = resolveTenantAccess(
            {
                status: "pending_payment",
                trial_ends_at: NOW.toISOString(),
                last_paid_at: null,
                plan: "essencial",
            },
            NOW
        );
        assert.equal(t.access, "deny");
        assert.equal(t.reason, "pending_payment");
        assert.equal(t.featuresEligible, false);
        assert.equal(t.plan_intent, "essencial");
    });

    it("pending_setup → deny", () => {
        const t = resolveTenantAccess(
            {
                status: "pending_setup",
                trial_ends_at: null,
                last_paid_at: null,
                plan: "pro",
            },
            NOW
        );
        assert.equal(t.access, "deny");
        assert.equal(t.reason, "pending_setup");
        assert.equal(t.featuresEligible, false);
    });

    it("trial válido → allow", () => {
        const t = resolveTenantAccess(
            {
                status: "trial",
                trial_ends_at: "2026-09-01T00:00:00.000Z",
                last_paid_at: null,
                plan: "pro",
            },
            NOW
        );
        assert.equal(t.access, "allow");
        assert.equal(t.reason, "trial");
        assert.equal(t.featuresEligible, true);
    });

    it("trial expirado → deny (trial_expired)", () => {
        const t = resolveTenantAccess(
            {
                status: "trial",
                trial_ends_at: "2026-08-01T00:00:00.000Z",
                last_paid_at: null,
                plan: "pro",
            },
            NOW
        );
        assert.equal(t.access, "deny");
        assert.equal(t.reason, "trial_expired");
        assert.equal(t.featuresEligible, false);
    });

    it("active → allow", () => {
        const t = resolveTenantAccess(
            {
                status: "active",
                trial_ends_at: null,
                last_paid_at: "2026-08-01T00:00:00.000Z",
                plan: "market",
            },
            NOW
        );
        assert.equal(t.access, "allow");
        assert.equal(t.reason, "active");
        assert.equal(t.featuresEligible, true);
    });

    it("overdue com last_paid_at → allow (grace)", () => {
        const t = resolveTenantAccess(
            {
                status: "overdue",
                trial_ends_at: null,
                last_paid_at: "2026-07-01T00:00:00.000Z",
                plan: "essencial",
            },
            NOW
        );
        assert.equal(t.access, "allow");
        assert.equal(t.reason, "overdue");
        assert.equal(t.featuresEligible, true);
    });

    it("overdue never-paid → deny (pending_payment efetivo)", () => {
        const t = resolveTenantAccess(
            {
                status: "overdue",
                trial_ends_at: null,
                last_paid_at: null,
                plan: "essencial",
            },
            NOW
        );
        assert.equal(t.access, "deny");
        assert.equal(t.reason, "pending_payment");
        assert.equal(t.featuresEligible, false);
    });

    it("blocked / cancelled → deny", () => {
        assert.equal(
            resolveTenantAccess(
                { status: "blocked", trial_ends_at: null, last_paid_at: null, plan: "pro" },
                NOW
            ).access,
            "deny"
        );
        assert.equal(
            resolveTenantAccess(
                { status: "cancelled", trial_ends_at: null, last_paid_at: null, plan: "pro" },
                NOW
            ).access,
            "deny"
        );
    });
});

describe("gateFeaturesByAccess", () => {
    it("esvazia features se deny", () => {
        const deny = resolveTenantAccess(
            {
                status: "pending_payment",
                trial_ends_at: null,
                last_paid_at: null,
                plan: "pro",
            },
            NOW
        );
        assert.deepEqual(gateFeaturesByAccess(deny, ["pdv", "financeiro_full"]), []);
    });

    it("mantém features se allow", () => {
        const allow = resolveTenantAccess(
            {
                status: "active",
                trial_ends_at: null,
                last_paid_at: "2026-08-01T00:00:00.000Z",
                plan: "pro",
            },
            NOW
        );
        assert.deepEqual(gateFeaturesByAccess(allow, ["pdv"]), ["pdv"]);
    });
});
