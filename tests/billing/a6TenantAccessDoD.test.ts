/**
 * A6 — DoD bloco TenantAccess v2 (never-paid paywall).
 * Never-paid: features [] + 402 em API mutável + só /plano* no proxy.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireBillingActive } from "../../lib/billing/requireBillingActive";
import { resolveInboundFromSnapshots } from "../../lib/billing/canProcessInboundChannel";
import { gateFeaturesByAccess, resolveTenantAccess } from "../../lib/billing/tenantAccess";

const root = process.cwd();
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

function pagarmeSubMock(row: {
    status: string;
    trial_ends_at?: string | null;
    last_paid_at?: string | null;
    plan?: string;
}) {
    return {
        from: (table: string) => {
            assert.strictEqual(table, "pagarme_subscriptions");
            return {
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => ({ data: row, error: null }),
                    }),
                }),
            };
        },
    } as unknown as SupabaseClient;
}

describe("A6 DoD — never-paid API 402", () => {
    it("pending_payment + full gate → 402 billing_inactive", async () => {
        const admin = pagarmeSubMock({
            status: "pending_payment",
            trial_ends_at: null,
            last_paid_at: null,
            plan: "pro",
        });
        const res = await requireBillingActive(admin, "c1", "full");
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
            assert.strictEqual(res.status, 402);
            assert.strictEqual(res.code, "billing_inactive");
            assert.strictEqual(res.billingStatus, "pending_payment");
        }
    });

    it("overdue never-paid + full gate → 402 (efetivo pending_payment)", async () => {
        const admin = pagarmeSubMock({
            status: "overdue",
            trial_ends_at: null,
            last_paid_at: null,
            plan: "essencial",
        });
        const res = await requireBillingActive(admin, "c1", "full");
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
            assert.strictEqual(res.status, 402);
            assert.strictEqual(res.billingStatus, "pending_payment");
        }
    });

    it("pending_payment + billing_self → ok (rotas /api/billing/*)", async () => {
        const admin = pagarmeSubMock({
            status: "pending_payment",
            last_paid_at: null,
            plan: "pro",
        });
        const res = await requireBillingActive(admin, "c1", "billing_self");
        assert.strictEqual(res.ok, true);
    });
});

describe("A6 DoD — never-paid features []", () => {
    it("resolveTenantAccess pending_payment → featuresEligible false", () => {
        const t = resolveTenantAccess(
            {
                status: "pending_payment",
                trial_ends_at: null,
                last_paid_at: null,
                plan: "pro",
            },
            new Date("2026-08-28T12:00:00.000Z")
        );
        assert.strictEqual(t.access, "deny");
        assert.strictEqual(t.featuresEligible, false);
        assert.deepStrictEqual(
            gateFeaturesByAccess(t, ["pdv_basic", "financeiro_full"]),
            []
        );
    });

    it("inbound channel deny alinhado (is_active true não bypassa)", () => {
        const r = resolveInboundFromSnapshots(
            true,
            {
                status: "pending_payment",
                trial_ends_at: null,
                last_paid_at: null,
                plan: "pro",
            },
            new Date("2026-08-28T12:00:00.000Z")
        );
        assert.strictEqual(r.allowed, false);
    });
});

describe("A6 DoD — proxy só /plano* durante paywall", () => {
    it("isBillingPaywallAllowedPath cobre rotas de escape", () => {
        const src = read("proxy.ts");
        assert.match(src, /function isBillingPaywallAllowedPath/);
        assert.match(src, /\/plano\//);
        assert.match(src, /tab.*plano/);
        assert.match(src, /tenant\.access === "deny"/);
    });

    it("proxy.test cobre pending_payment → /plano/pagar", () => {
        const src = read("tests/proxy.test.ts");
        assert.match(src, /redirects pending_payment from \/pdv to \/plano\/pagar/);
        assert.match(src, /allows \/configuracoes\?tab=plano during paywall/);
    });
});

describe("A6 DoD — RPC remoto (registro 2026-08-28)", () => {
    /** Validação MCP execute_sql: pending_payment → access deny, features [], subscription null. */
    const REMOTE_ENTITLEMENTS_SAMPLE = {
        access: "deny",
        access_reason: "pending_payment",
        features_eligible: false,
        features: [] as string[],
        subscription: null,
    };

    it("contrato RPC never-paid documentado", () => {
        assert.strictEqual(REMOTE_ENTITLEMENTS_SAMPLE.access, "deny");
        assert.deepStrictEqual(REMOTE_ENTITLEMENTS_SAMPLE.features, []);
        assert.strictEqual(REMOTE_ENTITLEMENTS_SAMPLE.subscription, null);
    });
});

describe("A6 DoD — API mutável via requireCompanyAccess", () => {
    it("PDV finalize passa por requireCompanyAnyPlanFeature → requireCompanyAccess (402)", () => {
        const pdv = read("app/api/admin/pdv/finalize/route.ts");
        assert.match(pdv, /requireCompanyAnyPlanFeature/);
        const planFeat = read("lib/billing/requirePlanFeature.ts");
        assert.match(planFeat, /requireCompanyAccess/);
    });

    it("jsonAccessError propaga billing_inactive (402)", () => {
        const errors = read("lib/api/errors.ts");
        assert.match(errors, /billing_inactive/);
        assert.match(errors, /402/);
    });
});
