/**
 * H4: cancel-before-create — paid → fulfill; senão cancel.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";

type ReconcileFn =
    typeof import("../../lib/billing/reconcileLivePagarmeOrder").reconcileOrCancelLiveOrder;

let reconcileOrCancelLiveOrder: ReconcileFn;
let fulfillPaidResult: { fulfilled: boolean; alreadyDone?: boolean } = {
    fulfilled: false,
};
let cancelCalls: string[] = [];

before(() => {
    const root = join(__dirname, "..", "..");
    const paths = {
        pagarme: join(root, "lib", "billing", "pagarme.js"),
        sync: join(root, "lib", "billing", "syncPendingObligationFromPsp.js"),
        log: join(root, "lib", "billing", "billingLog.js"),
        recon: join(root, "lib", "billing", "reconcileLivePagarmeOrder.js"),
    };

    const cache = require.cache as unknown as Record<string, unknown>;
    cache[paths.pagarme] = {
        id: paths.pagarme,
        filename: paths.pagarme,
        loaded: true,
        exports: {
            cancelPagarmeChargeBestEffort: async (id: string) => {
                cancelCalls.push(id);
            },
        },
    };
    cache[paths.sync] = {
        id: paths.sync,
        filename: paths.sync,
        loaded: true,
        exports: {
            fulfillIfPagarmeOrderPaid: async () => fulfillPaidResult,
        },
    };
    cache[paths.log] = {
        id: paths.log,
        filename: paths.log,
        loaded: true,
        exports: { billingLog: () => {} },
    };

    delete cache[paths.recon];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    reconcileOrCancelLiveOrder = require(paths.recon).reconcileOrCancelLiveOrder;
});

describe("reconcileOrCancelLiveOrder", () => {
    it("noop sem order_id", async () => {
        cancelCalls = [];
        const r = await reconcileOrCancelLiveOrder(
            {} as SupabaseClient,
            null,
            "invoice"
        );
        assert.equal(r.action, "noop");
        assert.equal(cancelCalls.length, 0);
    });

    it("fulfilled quando PSP paid (não cancela)", async () => {
        cancelCalls = [];
        fulfillPaidResult = { fulfilled: true, alreadyDone: false };
        const r = await reconcileOrCancelLiveOrder(
            {} as SupabaseClient,
            "or_paid",
            "invoice"
        );
        assert.equal(r.action, "fulfilled");
        assert.equal(cancelCalls.length, 0);
    });

    it("cancelled quando PSP não paid", async () => {
        cancelCalls = [];
        fulfillPaidResult = { fulfilled: false };
        const r = await reconcileOrCancelLiveOrder(
            {} as SupabaseClient,
            "or_open",
            "invoice"
        );
        assert.equal(r.action, "cancelled");
        assert.deepEqual(cancelCalls, ["or_open"]);
    });
});
