import assert from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
    fetchCompanyEntitlements,
    type CompanyEntitlementsPayload,
} from "../../lib/billing/fetchCompanyEntitlements";
import { getEnabledFeatures, getActiveSubscription } from "../../lib/billing/entitlements";

const SAMPLE: CompanyEntitlementsPayload = {
    company_id: "c1",
    access: "allow",
    access_reason: "trial",
    features_eligible: true,
    pagarme: {
        status: "trial",
        plan: "pro",
        trial_ends_at: "2026-09-01T00:00:00.000Z",
        last_paid_at: null,
        next_billing_at: null,
        activated_at: "2026-08-28T00:00:00.000Z",
    },
    subscription: {
        id: "sub-1",
        plan_id: "plan-pro",
        plan_key: "pro",
        plan_name: "Pro",
        status: "active",
        allow_overage: false,
    },
    features: ["pdv_basic", "financeiro_full"],
};

describe("fetchCompanyEntitlements", () => {
    it("parses RPC payload", async () => {
        const admin = {
            rpc: async () => ({
                data: {
                    company_id: SAMPLE.company_id,
                    pagarme: SAMPLE.pagarme,
                    subscription: SAMPLE.subscription,
                    features: SAMPLE.features,
                },
                error: null,
            }),
        } as unknown as SupabaseClient;

        const ent = await fetchCompanyEntitlements(admin, "c1");
        assert.strictEqual(ent.subscription?.plan_key, "pro");
        assert.deepStrictEqual(ent.features, ["pdv_basic", "financeiro_full"]);
    });
});

describe("entitlements via RPC (P2.2)", () => {
    it("getActiveSubscription + getEnabledFeatures from single RPC shape", async () => {
        const admin = {
            rpc: async () => ({
                data: {
                    company_id: "c1",
                    pagarme: SAMPLE.pagarme,
                    subscription: SAMPLE.subscription,
                    features: SAMPLE.features,
                },
                error: null,
            }),
        } as unknown as SupabaseClient;

        const sub = await getActiveSubscription(admin, "c1");
        assert.ok(sub);
        assert.strictEqual(sub!.plan_key, "pro");

        const features = await getEnabledFeatures(admin, "c1");
        assert.strictEqual(features.has("pdv_basic"), true);
        assert.strictEqual(features.has("financeiro_full"), true);
    });

    it("empty subscription → no features", async () => {
        const admin = {
            rpc: async () => ({
                data: {
                    company_id: "c1",
                    access: "deny",
                    access_reason: "blocked",
                    features_eligible: false,
                    pagarme: { status: "blocked", plan: "pro" },
                    subscription: null,
                    features: [],
                },
                error: null,
            }),
        } as unknown as SupabaseClient;

        assert.strictEqual(await getActiveSubscription(admin, "c1"), null);
        assert.strictEqual((await getEnabledFeatures(admin, "c1")).size, 0);
    });

    it("pending_payment com features no payload cru → gate esvazia (defense-in-depth)", async () => {
        const admin = {
            rpc: async () => ({
                data: {
                    company_id: "c1",
                    access: "allow",
                    access_reason: "active",
                    features_eligible: true,
                    pagarme: {
                        status: "pending_payment",
                        plan: "pro",
                        trial_ends_at: null,
                        last_paid_at: null,
                    },
                    // Simula RPC antiga vazando features
                    subscription: {
                        id: "sub-1",
                        plan_id: "plan-pro",
                        plan_key: "pro",
                        plan_name: "Pro",
                        status: "active",
                        allow_overage: false,
                    },
                    features: ["pdv", "financeiro_full"],
                },
                error: null,
            }),
        } as unknown as SupabaseClient;

        const ent = await fetchCompanyEntitlements(admin, "c1");
        assert.strictEqual(ent.access, "deny");
        assert.strictEqual(ent.access_reason, "pending_payment");
        assert.strictEqual(ent.features_eligible, false);
        assert.deepStrictEqual(ent.features, []);
        assert.strictEqual(ent.subscription, null);
        assert.strictEqual(await getActiveSubscription(admin, "c1"), null);
    });
});
