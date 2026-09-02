/**
 * Sync pending obligation from PSP — rede de segurança (não substitui webhook).
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { join } from "node:path";
import { makeMockAdmin } from "../helpers/mockSupabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

type SyncFn = typeof import("../../lib/billing/syncPendingObligationFromPsp").syncPendingObligationFromPsp;

let syncPendingObligationFromPsp: SyncFn;
let mockGetOrder: (id: string) => Promise<unknown>;
let fulfillCalls: unknown[] = [];

before(() => {
    const root = join(__dirname, "..", "..");
    const paths = {
        pagarme: join(root, "lib", "billing", "pagarme.js"),
        fulfill: join(root, "lib", "billing", "fulfillPayment.js"),
        log: join(root, "lib", "billing", "billingLog.js"),
        sync: join(root, "lib", "billing", "syncPendingObligationFromPsp.js"),
    };

    mockGetOrder = async () => ({ id: "or_x", status: "pending" });

    const cache = require.cache as unknown as Record<string, unknown>;
    cache[paths.pagarme] = {
        id: paths.pagarme,
        filename: paths.pagarme,
        loaded: true,
        exports: {
            getPagarmeOrder: (id: string) => mockGetOrder(id),
            isOrderCreditPaid: (o: { status?: string; charges?: { status?: string }[] }) =>
                o.status === "paid" || o.charges?.[0]?.status === "paid",
        },
    };
    cache[paths.fulfill] = {
        id: paths.fulfill,
        filename: paths.fulfill,
        loaded: true,
        exports: {
            fulfillPayment: async (_admin: unknown, order: unknown) => {
                fulfillCalls.push(order);
                return { ok: true, kind: "invoice", alreadyDone: false };
            },
        },
    };
    cache[paths.log] = {
        id: paths.log,
        filename: paths.log,
        loaded: true,
        exports: { billingLog: () => {} },
    };

    delete cache[paths.sync];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    syncPendingObligationFromPsp = require(paths.sync).syncPendingObligationFromPsp;
});

describe("syncPendingObligationFromPsp", () => {
    it("noop quando não há pending com order_id", async () => {
        fulfillCalls = [];
        const db = makeMockAdmin({ setup_payments: [], invoices: [] });
        const r = await syncPendingObligationFromPsp(
            db.client as unknown as SupabaseClient,
            "co-1"
        );
        assert.equal(r.action, "noop");
        assert.equal(fulfillCalls.length, 0);
    });

    it("pending quando order PSP ainda não paid", async () => {
        fulfillCalls = [];
        mockGetOrder = async () => ({
            id: "or_1",
            status: "pending",
            charges: [{ status: "waiting" }],
        });
        const db = makeMockAdmin({
            setup_payments: [],
            invoices: [
                {
                    id: "inv-1",
                    company_id: "co-1",
                    status: "pending",
                    pagarme_order_id: "or_1",
                    created_at: "2026-09-02T00:00:00.000Z",
                },
            ],
        });
        const r = await syncPendingObligationFromPsp(
            db.client as unknown as SupabaseClient,
            "co-1"
        );
        assert.equal(r.action, "pending");
        assert.equal(r.order_id, "or_1");
        assert.equal(fulfillCalls.length, 0);
    });

    it("fulfilled quando invoice pending e PSP paid", async () => {
        fulfillCalls = [];
        mockGetOrder = async () => ({
            id: "or_paid",
            status: "paid",
            metadata: { company_id: "co-1" },
            customer: { id: "cus_1" },
        });
        const db = makeMockAdmin({
            setup_payments: [],
            invoices: [
                {
                    id: "inv-1",
                    company_id: "co-1",
                    status: "pending",
                    pagarme_order_id: "or_paid",
                    created_at: "2026-09-02T00:00:00.000Z",
                },
            ],
        });
        const r = await syncPendingObligationFromPsp(
            db.client as unknown as SupabaseClient,
            "co-1"
        );
        assert.equal(r.action, "fulfilled");
        assert.equal(r.kind, "invoice");
        assert.equal(fulfillCalls.length, 1);
        assert.equal((fulfillCalls[0] as { id: string }).id, "or_paid");
    });

    it("prioriza setup pending sobre invoice", async () => {
        fulfillCalls = [];
        mockGetOrder = async () => ({ id: "or_setup", status: "paid" });
        const db = makeMockAdmin({
            setup_payments: [
                {
                    id: "sp-1",
                    company_id: "co-1",
                    status: "pending",
                    pagarme_order_id: "or_setup",
                    created_at: "2026-09-02T00:00:00.000Z",
                },
            ],
            invoices: [
                {
                    id: "inv-1",
                    company_id: "co-1",
                    status: "pending",
                    pagarme_order_id: "or_inv",
                    created_at: "2026-09-02T00:00:00.000Z",
                },
            ],
        });
        const r = await syncPendingObligationFromPsp(
            db.client as unknown as SupabaseClient,
            "co-1"
        );
        assert.equal(r.action, "fulfilled");
        assert.equal(r.kind, "setup");
        assert.equal(r.order_id, "or_setup");
    });
});
