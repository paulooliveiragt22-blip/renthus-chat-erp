import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rebillPendingObligationAfterPlanChange } from "../../lib/billing/rebillPendingObligation";

function mockAdmin(opts: {
    sub: Record<string, unknown> | null;
    pending: Record<string, unknown> | null;
    rpc?: { status: string; amount_cents: number; invoice_id: string; realigned?: boolean };
}) {
    const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = [];
    const updates: Array<Record<string, unknown>> = [];
    const admin = {
        from(table: string) {
            const filters: Record<string, unknown> = {};
            const api = {
                select() {
                    return api;
                },
                eq(col: string, val: unknown) {
                    filters[col] = val;
                    return api;
                },
                in() {
                    return api;
                },
                order() {
                    return api;
                },
                limit() {
                    return api;
                },
                maybeSingle: async () => {
                    if (table === "pagarme_subscriptions") {
                        return { data: opts.sub, error: null };
                    }
                    if (table === "invoices") {
                        return { data: opts.pending, error: null };
                    }
                    return { data: null, error: null };
                },
                update(payload: Record<string, unknown>) {
                    updates.push(payload);
                    return {
                        eq() {
                            return {
                                eq() {
                                    return Promise.resolve({ error: null });
                                },
                            };
                        },
                    };
                },
                then(resolve: (v: unknown) => void) {
                    resolve({ data: null, error: null });
                },
            };
            return api;
        },
        rpc: async (name: string, params: Record<string, unknown>) => {
            rpcCalls.push({ name, params });
            return {
                data: opts.rpc ?? {
                    status: "exists",
                    amount_cents: 27900,
                    invoice_id: "inv-1",
                    realigned: false,
                },
                error: null,
            };
        },
    };
    return { admin, rpcCalls, updates };
}

describe("rebillPendingObligationAfterPlanChange", () => {
    it("active sem pending não cria obrigação", async () => {
        const { admin, rpcCalls } = mockAdmin({
            sub: { id: "s1", status: "active", plan: "essencial" },
            pending: null,
        });
        const r = await rebillPendingObligationAfterPlanChange(
            admin as never,
            "co-1",
            "pro"
        );
        assert.equal(r.action, "noop");
        assert.equal(rpcCalls.length, 0);
    });

    it("pending_payment chama RPC e não grava amount no app", async () => {
        const { admin, rpcCalls, updates } = mockAdmin({
            sub: { id: "s1", status: "pending_payment", plan: "pro" },
            pending: { id: "inv-1", amount: 279, pagarme_order_id: null, kind: "subscription" },
            rpc: {
                status: "realigned",
                amount_cents: 34900,
                invoice_id: "inv-1",
                realigned: true,
            },
        });
        const r = await rebillPendingObligationAfterPlanChange(
            admin as never,
            "co-1",
            "pro"
        );
        assert.equal(r.action, "rebilled");
        assert.equal(r.amount_brl, 349);
        assert.equal(rpcCalls[0]?.name, "rpc_create_billing_obligation");
        assert.equal(rpcCalls[0]?.params.p_company_id, "co-1");
        assert.ok(!updates.some((u) => "amount" in u));
    });
});
