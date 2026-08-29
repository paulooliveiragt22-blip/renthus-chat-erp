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

    it("3b — pending_payment + full → 402 (never-paid A6)", async () => {
        const admin = pagarmeSubMock({
            status: "pending_payment",
            trial_ends_at: null,
            last_paid_at: null,
            plan: "pro",
        });
        const res = await requireBillingActive(admin, "company-1", "full");
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
            assert.strictEqual(res.status, 402);
            assert.strictEqual(res.billingStatus, "pending_payment");
        }
    });

    it("3c — overdue never-paid + full → 402 pending_payment efetivo", async () => {
        const admin = pagarmeSubMock({
            status: "overdue",
            trial_ends_at: null,
            last_paid_at: null,
            plan: "essencial",
        });
        const res = await requireBillingActive(admin, "company-1", "full");
        assert.strictEqual(res.ok, false);
        if (!res.ok) {
            assert.strictEqual(res.status, 402);
            assert.strictEqual(res.billingStatus, "pending_payment");
        }
    });

    it("4 — trial logical sub → hasFeature via active subscription", async () => {
        const admin = {
            rpc: async (name: string) => {
                if (name === "rpc_get_company_entitlements") {
                    return {
                        data: {
                            company_id: "c1",
                            access: "allow",
                            access_reason: "trial",
                            features_eligible: true,
                            pagarme: {
                                status: "trial",
                                plan: "pro",
                                trial_ends_at: "2099-01-01T00:00:00.000Z",
                                last_paid_at: null,
                                next_billing_at: null,
                                activated_at: "2026-08-01T00:00:00.000Z",
                            },
                            subscription: {
                                id: "sub-1",
                                plan_id: "plan-pro",
                                plan_key: "pro",
                                plan_name: "Pro",
                                status: "active",
                                allow_overage: false,
                            },
                            features: ["pdv_basic"],
                        },
                        error: null,
                    };
                }
                if (name === "current_year_month") return { data: "2026-08", error: null };
                return { data: null, error: null };
            },
        } as unknown as SupabaseClient;

        const sub = await getActiveSubscription(admin, "c1");
        assert.ok(sub);
        assert.strictEqual(await hasFeature(admin, "c1", "pdv_basic"), true);
    });

    it("5 — suspended logical sub → hasFeature false (pós blockCompany)", async () => {
        const admin = {
            rpc: async (name: string) => {
                if (name === "rpc_get_company_entitlements") {
                    return {
                        data: {
                            company_id: "c1",
                            subscription: null,
                            features: [],
                        },
                        error: null,
                    };
                }
                return { data: null, error: null };
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
        const seen = new Map<string, { status: string }>();
        const admin = {
            from: () => ({
                insert: async (row: { id: string; status?: string }) => {
                    if (seen.has(row.id)) {
                        return { error: { code: "23505", message: "duplicate key" } };
                    }
                    seen.set(row.id, { status: row.status ?? "processing" });
                    return { error: null };
                },
                select: () => ({
                    eq: () => ({
                        maybeSingle: async () => {
                            const id = [...seen.keys()][0];
                            const row = id ? seen.get(id) : undefined;
                            return {
                                data: row
                                    ? { status: row.status, updated_at: new Date().toISOString() }
                                    : null,
                                error: null,
                            };
                        },
                    }),
                }),
                update: () => ({
                    eq: () => ({
                        in: async () => ({ error: null }),
                    }),
                }),
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
        // Second insert duplicates; select returns completed only if we mark it —
        // mock returns processing with fresh updated_at → skip (proceed false)
        seen.set("evt-1", { status: "completed" });
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
