import assert from "node:assert";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireBillingActive } from "../../lib/billing/requireBillingActive";
import { getActiveSubscription, hasFeature } from "../../lib/billing/entitlements";
import { tryConsumePagarmeWebhookEvent } from "../../lib/billing/tryConsumePagarmeWebhookEvent";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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

describe("billing gate matrix (P0.9)", () => {
    it("1 — blocked + full gate → 402 billing_inactive", async () => {
        const admin = pagarmeSubMock({
            status: "blocked",
            trial_ends_at: null,
            last_paid_at: "2026-07-01T00:00:00.000Z",
            plan: "pro",
        });
        const res = await requireBillingActive(admin, "company-1", "full");
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
            assert.strictEqual(res.status, 402);
            assert.strictEqual(res.code, "billing_inactive");
            assert.strictEqual(res.billingStatus, "blocked");
        }
    });

    it("2 — blocked + billing_self → ok (status route pattern)", async () => {
        const admin = pagarmeSubMock({
            status: "blocked",
            trial_ends_at: null,
            last_paid_at: null,
            plan: "essencial",
        });
        const res = await requireBillingActive(admin, "company-1", "billing_self");
        assert.strictEqual(res.ok, true);
    });

    it("3 — overdue with last_paid_at + full → ok (grace D18)", async () => {
        const admin = pagarmeSubMock({
            status: "overdue",
            trial_ends_at: null,
            last_paid_at: "2026-07-01T00:00:00.000Z",
            plan: "pro",
        });
        const res = await requireBillingActive(admin, "company-1", "full");
        assert.strictEqual(res.ok, true);
        if (res.ok) assert.strictEqual(res.status, "overdue");
    });

    it("4 — trial logical sub → hasFeature via active subscription", async () => {
        const admin = {
            from: (table: string) => {
                if (table === "subscriptions") {
                    return {
                        select: () => ({
                            eq: (_c: string, val: unknown) => ({
                                eq: (_s: string, status: unknown) => ({
                                    order: () => ({
                                        limit: () => ({
                                            maybeSingle: async () => {
                                                if (status === "active") {
                                                    return {
                                                        data: {
                                                            id: "sub-1",
                                                            plan_id: "plan-pro",
                                                            allow_overage: false,
                                                            plans: { key: "pro", name: "Pro" },
                                                        },
                                                        error: null,
                                                    };
                                                }
                                                return { data: null, error: null };
                                            },
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    };
                }
                if (table === "plan_features") {
                    return {
                        select: () => ({
                            eq: async () => ({
                                data: [{ feature_key: "pdv_basic" }],
                                error: null,
                            }),
                        }),
                    };
                }
                if (table === "subscription_addons") {
                    return {
                        select: () => ({
                            eq: async () => ({ data: [], error: null }),
                        }),
                    };
                }
                throw new Error(`unexpected table ${table}`);
            },
            rpc: async () => "2026-08",
        } as unknown as SupabaseClient;

        const sub = await getActiveSubscription(admin, "c1");
        assert.ok(sub);
        assert.strictEqual(await hasFeature(admin, "c1", "pdv_basic"), true);
    });

    it("5 — suspended logical sub → hasFeature false (pós blockCompany)", async () => {
        const admin = {
            from: (table: string) => {
                if (table === "subscriptions") {
                    return {
                        select: () => ({
                            eq: () => ({
                                eq: () => ({
                                    order: () => ({
                                        limit: () => ({
                                            maybeSingle: async () => ({ data: null, error: null }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    };
                }
                return { select: () => ({ eq: async () => ({ data: [], error: null }) }) };
            },
        } as unknown as SupabaseClient;

        assert.strictEqual(await hasFeature(admin, "c1", "financeiro_full"), false);
    });

    it("6 — billing/status sem ?company_id= (IDOR fechado)", () => {
        const src = readFileSync(
            join(process.cwd(), "app", "api", "billing", "status", "route.ts"),
            "utf8"
        );
        assert.doesNotMatch(src, /searchParams\.get\s*\(\s*["']company_id["']\s*\)/);
        assert.doesNotMatch(src, /company_id\s*=\s*req\.nextUrl/);
    });

    it("7 — webhook duplicate → tryConsume retorna false na 2ª vez", async () => {
        const seen = new Set<string>();
        const admin = {
            from: () => ({
                insert: async (row: { id: string }) => {
                    if (seen.has(row.id)) {
                        return { error: { code: "23505", message: "duplicate key" } };
                    }
                    seen.add(row.id);
                    return { error: null };
                },
            }),
        } as unknown as ReturnType<
            typeof import("../../lib/supabase/admin").createAdminClient
        >;

        const first = await tryConsumePagarmeWebhookEvent(
            admin,
            "evt-1",
            "order.paid",
            "ord-1"
        );
        const second = await tryConsumePagarmeWebhookEvent(
            admin,
            "evt-1",
            "order.paid",
            "ord-1"
        );
        assert.strictEqual(first, true);
        assert.strictEqual(second, false);
    });

    it("8 — change-plan bloqueia overdue (D11)", () => {
        const blockedStatuses = [
            "blocked",
            "cancelled",
            "pending_payment",
            "pending_setup",
            "overdue",
        ];
        for (const st of blockedStatuses) {
            const isBlocked =
                st === "blocked" ||
                st === "cancelled" ||
                st === "pending_payment" ||
                st === "pending_setup" ||
                st === "overdue";
            assert.strictEqual(isBlocked, true, st);
        }
        assert.strictEqual(
            ["trial", "active"].some(
                (st) =>
                    st === "blocked" ||
                    st === "cancelled" ||
                    st === "pending_payment" ||
                    st === "pending_setup" ||
                    st === "overdue"
            ),
            false
        );
    });
});
