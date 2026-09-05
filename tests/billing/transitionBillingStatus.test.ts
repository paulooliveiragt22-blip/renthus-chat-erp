import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeMockAdmin } from "../helpers/mockSupabaseAdmin";
import {
    markAbandonedDue,
    transitionBillingStatus,
} from "../../lib/billing/transitionBillingStatus";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("transitionBillingStatus", () => {
    it("active + last_paid → overdue (claimed)", async () => {
        const db = makeMockAdmin({
            pagarme_subscriptions: [
                {
                    id: "sub-1",
                    company_id: "co-1",
                    status: "active",
                    last_paid_at: "2026-07-01T00:00:00.000Z",
                    updated_at: "2026-08-01T00:00:00.000Z",
                },
            ],
        });
        const r = await transitionBillingStatus(db.client as unknown as SupabaseClient, {
            companyId: "co-1",
            to: "overdue",
            casUpdatedAt: "2026-08-01T00:00:00.000Z",
        });
        assert.equal(r.status, "transitioned");
        assert.equal(r.claimed, true);
        assert.equal(db.tables.pagarme_subscriptions?.[0]?.status, "overdue");
    });

    it("CAS mismatch → conflict e não sobrescreve", async () => {
        const db = makeMockAdmin({
            pagarme_subscriptions: [
                {
                    id: "sub-1",
                    company_id: "co-1",
                    status: "active",
                    last_paid_at: "2026-07-01T00:00:00.000Z",
                    updated_at: "2026-08-02T00:00:00.000Z",
                },
            ],
        });
        const r = await transitionBillingStatus(db.client as unknown as SupabaseClient, {
            companyId: "co-1",
            to: "overdue",
            casUpdatedAt: "2026-08-01T00:00:00.000Z",
        });
        assert.equal(r.status, "conflict");
        assert.equal(r.claimed, false);
        assert.equal(db.tables.pagarme_subscriptions?.[0]?.status, "active");
    });

    it("blocked desativa company na mesma chamada", async () => {
        const db = makeMockAdmin({
            pagarme_subscriptions: [
                {
                    id: "sub-1",
                    company_id: "co-1",
                    status: "overdue",
                    last_paid_at: "2026-07-01T00:00:00.000Z",
                },
            ],
            companies: [{ id: "co-1", is_active: true }],
        });
        const r = await transitionBillingStatus(db.client as unknown as SupabaseClient, {
            companyId: "co-1",
            to: "blocked",
        });
        assert.equal(r.claimed, true);
        assert.equal(db.tables.companies?.[0]?.is_active, false);
    });
});

describe("markAbandonedDue", () => {
    it("marca pending_payment never-paid + empresa inativa + 14d", async () => {
        const stale = new Date(Date.now() - 15 * 86_400_000).toISOString();
        const db = makeMockAdmin({
            pagarme_subscriptions: [
                {
                    id: "sub-old",
                    company_id: "co-old",
                    status: "pending_payment",
                    last_paid_at: null,
                    abandoned_at: null,
                    created_at: stale,
                },
                {
                    id: "sub-fresh",
                    company_id: "co-fresh",
                    status: "pending_payment",
                    last_paid_at: null,
                    abandoned_at: null,
                    created_at: new Date().toISOString(),
                },
            ],
            companies: [
                { id: "co-old", is_active: false },
                { id: "co-fresh", is_active: false },
            ],
        });
        const r = await markAbandonedDue(db.client as unknown as SupabaseClient);
        assert.equal(r.marked, 1);
        assert.deepEqual(r.companyIds, ["co-old"]);
        assert.equal(db.tables.pagarme_subscriptions?.[0]?.status, "abandoned");
        assert.equal(db.tables.pagarme_subscriptions?.[1]?.status, "pending_payment");
    });
});
