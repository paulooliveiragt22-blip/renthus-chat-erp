import assert from "node:assert";
import { describe, it } from "node:test";
import {
    billingInactiveMessage,
    isBillingAccessAllowed,
    resolveEffectiveBillingStatus,
} from "../../lib/billing/resolveBillingAccess";

const NOW = new Date("2026-08-28T15:00:00.000Z");

describe("resolveEffectiveBillingStatus", () => {
    it("missing when null", () => {
        assert.strictEqual(resolveEffectiveBillingStatus(null, NOW), "missing");
    });

    it("trial valid when ends_at in future", () => {
        assert.strictEqual(
            resolveEffectiveBillingStatus(
                {
                    status: "trial",
                    trial_ends_at: "2026-09-01T00:00:00.000Z",
                    last_paid_at: null,
                    plan: "pro",
                },
                NOW
            ),
            "trial"
        );
    });

    it("trial_expired when ends_at past", () => {
        assert.strictEqual(
            resolveEffectiveBillingStatus(
                {
                    status: "trial",
                    trial_ends_at: "2026-08-01T00:00:00.000Z",
                    last_paid_at: null,
                    plan: "pro",
                },
                NOW
            ),
            "trial_expired"
        );
    });

    it("overdue with last_paid_at stays overdue", () => {
        assert.strictEqual(
            resolveEffectiveBillingStatus(
                {
                    status: "overdue",
                    trial_ends_at: null,
                    last_paid_at: "2026-07-01T00:00:00.000Z",
                    plan: "pro",
                },
                NOW
            ),
            "overdue"
        );
    });

    it("overdue never-paid maps to pending_payment", () => {
        assert.strictEqual(
            resolveEffectiveBillingStatus(
                {
                    status: "overdue",
                    trial_ends_at: null,
                    last_paid_at: null,
                    plan: "pro",
                },
                NOW
            ),
            "pending_payment"
        );
    });

    it("pending_payment / blocked / cancelled / abandoned passthrough", () => {
        assert.strictEqual(
            resolveEffectiveBillingStatus(
                {
                    status: "pending_payment",
                    trial_ends_at: NOW.toISOString(),
                    last_paid_at: null,
                    plan: "essencial",
                },
                NOW
            ),
            "pending_payment"
        );
        assert.strictEqual(
            resolveEffectiveBillingStatus(
                { status: "blocked", trial_ends_at: null, last_paid_at: null, plan: "pro" },
                NOW
            ),
            "blocked"
        );
        assert.strictEqual(
            resolveEffectiveBillingStatus(
                { status: "cancelled", trial_ends_at: null, last_paid_at: null, plan: "pro" },
                NOW
            ),
            "cancelled"
        );
        assert.strictEqual(
            resolveEffectiveBillingStatus(
                { status: "abandoned", trial_ends_at: null, last_paid_at: null, plan: "pro" },
                NOW
            ),
            "abandoned"
        );
    });
});

describe("isBillingAccessAllowed", () => {
    it("full allows trial/active/overdue only", () => {
        assert.strictEqual(isBillingAccessAllowed("trial", "full"), true);
        assert.strictEqual(isBillingAccessAllowed("active", "full"), true);
        assert.strictEqual(isBillingAccessAllowed("overdue", "full"), true);
        assert.strictEqual(isBillingAccessAllowed("pending_payment", "full"), false);
        assert.strictEqual(isBillingAccessAllowed("trial_expired", "full"), false);
        assert.strictEqual(isBillingAccessAllowed("blocked", "full"), false);
        // abandoned: deny por default (paywall mantém empresa bloqueada para API mutável)
        assert.strictEqual(isBillingAccessAllowed("abandoned", "full"), false);
    });

    it("billing_self and skip always allow", () => {
        assert.strictEqual(isBillingAccessAllowed("blocked", "billing_self"), true);
        assert.strictEqual(isBillingAccessAllowed("pending_payment", "skip"), true);
        assert.strictEqual(isBillingAccessAllowed("abandoned", "skip"), true);
    });
});

describe("billingInactiveMessage", () => {
    it("returns pt-BR copy", () => {
        assert.match(billingInactiveMessage("pending_payment"), /Pagamento/);
        assert.match(billingInactiveMessage("blocked"), /bloqueada/i);
    });

    it("abandoned copy mentions reativação", () => {
        assert.match(billingInactiveMessage("abandoned"), /reativ/i);
        assert.match(billingInactiveMessage("abandoned"), /inativ/i);
    });
});
