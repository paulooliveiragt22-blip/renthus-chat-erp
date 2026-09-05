/**
 * R2.5 — CollectPayment: card ok; card fail→PIX; unique pending.
 * Mocks Pagar.me + fulfill via require.cache (mesmo padrão da fila).
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { join } from "node:path";
import { makeMockAdmin } from "../helpers/mockSupabaseAdmin";
import type { SupabaseClient } from "@supabase/supabase-js";

type CollectFn = typeof import("../../lib/billing/collectPayment").collectPayment;

let collectPayment: CollectFn;
let mockPagarme: {
    createOrderWithSavedCard: (...args: unknown[]) => Promise<unknown>;
    createPixInvoiceOrder: (...args: unknown[]) => Promise<unknown>;
    resolvePixFromOrder: (...args: unknown[]) => Promise<unknown>;
    isOrderCreditPaid: (o: unknown) => boolean;
    getMonthlyPriceCents: (plan: string) => number;
    centsToBRL: (c: number) => number;
    getPagarmeOrder: (id: string) => Promise<unknown>;
    cancelPagarmeChargeBestEffort: (id: string) => Promise<void>;
};
let fulfillCalls: unknown[] = [];

const SUB = {
    id: "sub-1",
    company_id: "co-1",
    plan: "essencial",
    pagarme_customer_id: "cus_1",
    default_card_id: "card_1",
    last_paid_at: "2026-07-01T00:00:00.000Z",
    companies: {
        name: "Loja",
        email: "a@b.com",
        whatsapp_phone: null,
        cnpj: "11444777000161",
    },
};

before(() => {
    const root = join(__dirname, "..", "..");
    const paths = {
        pagarme: join(root, "lib", "billing", "pagarme.js"),
        fulfill: join(root, "lib", "billing", "fulfillPayment.js"),
        notify: join(root, "lib", "billing", "sendBillingNotification.js"),
        collect: join(root, "lib", "billing", "collectPayment.js"),
        log: join(root, "lib", "billing", "billingLog.js"),
        recon: join(root, "lib", "billing", "reconcileLivePagarmeOrder.js"),
    };

    mockPagarme = {
        createOrderWithSavedCard: async () => ({
            id: "ord_card",
            charges: [{ status: "paid" }],
        }),
        createPixInvoiceOrder: async () => ({
            id: "ord_pix",
            charges: [{ status: "pending", last_transaction: { qr_code: "00020126BR.GOV.BCB.PIX" } }],
        }),
        resolvePixFromOrder: async (order: unknown) => ({
            order,
            pixUrl: "https://pix.example/qr",
            pixCode: "00020126BR.GOV.BCB.PIX",
        }),
        isOrderCreditPaid: (o: unknown) =>
            Boolean((o as { charges?: { status?: string }[] })?.charges?.[0]?.status === "paid"),
        getMonthlyPriceCents: () => 19700,
        centsToBRL: (c: number) => c / 100,
        getPagarmeOrder: async (id: string) => ({ id, status: "pending" }),
        cancelPagarmeChargeBestEffort: async () => {},
    };

    const cache = require.cache as unknown as Record<string, unknown>;
    cache[paths.pagarme] = {
        id: paths.pagarme,
        filename: paths.pagarme,
        loaded: true,
        exports: mockPagarme,
    };
    cache[paths.fulfill] = {
        id: paths.fulfill,
        filename: paths.fulfill,
        loaded: true,
        exports: {
            fulfillPayment: async (_admin: unknown, order: unknown) => {
                fulfillCalls.push(order);
                return { kind: "invoice", alreadyDone: false };
            },
        },
    };
    cache[paths.notify] = {
        id: paths.notify,
        filename: paths.notify,
        loaded: true,
        exports: {
            sendBillingNotification: async () => ({ ok: true }),
            buildOverdueMessage: () => "msg",
        },
    };
    cache[paths.log] = {
        id: paths.log,
        filename: paths.log,
        loaded: true,
        exports: { billingLog: () => {} },
    };
    // H4: cancel-before-create — default noop nos testes de happy path
    cache[paths.recon] = {
        id: paths.recon,
        filename: paths.recon,
        loaded: true,
        exports: {
            reconcileOrCancelLiveOrder: async () => ({ action: "noop" }),
        },
    };

    delete cache[paths.collect];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    collectPayment = require(paths.collect).collectPayment;
});

function adminWithPending(invoice?: Record<string, unknown> | null) {
    const invoices = invoice ? [invoice] : [];
    const handle = makeMockAdmin({
        invoices,
        payment_attempts: [],
        pagarme_subscriptions: [
            {
                id: SUB.id,
                company_id: SUB.company_id,
                status: "active",
                last_paid_at: SUB.last_paid_at,
                updated_at: "2026-08-01T00:00:00.000Z",
            },
        ],
    });
    return handle;
}

describe("collectPayment (R2.5)", () => {
    it("card ok → paid_card + fulfill", async () => {
        fulfillCalls = [];
        mockPagarme.createOrderWithSavedCard = async () => ({
            id: "ord_paid",
            charges: [{ status: "paid" }],
            metadata: { type: "invoice" },
        });
        mockPagarme.isOrderCreditPaid = () => true;

        const db = adminWithPending(null);
        const res = await collectPayment(db.client as unknown as SupabaseClient, {
            sub: SUB,
            kind: "subscription_renewal",
            prefer: "card",
            attemptN: 1,
            now: new Date("2026-08-28T12:00:00.000Z"),
            fallbackSubStatus: "overdue",
            notifyWhatsApp: false,
        });

        assert.equal(res.ok, true);
        if (res.ok) {
            assert.equal(res.outcome, "paid_card");
            assert.ok(res.invoiceId);
            assert.equal(res.orderId, "ord_paid");
        }
        assert.equal(fulfillCalls.length, 1);
    });

    it("card fail → PIX pending na mesma invoice", async () => {
        fulfillCalls = [];
        mockPagarme.createOrderWithSavedCard = async () => ({
            id: "ord_fail",
            charges: [{ status: "failed", last_transaction: { acquirer_message: "declined" } }],
        });
        mockPagarme.isOrderCreditPaid = () => false;

        const db = adminWithPending(null);
        const res = await collectPayment(db.client as unknown as SupabaseClient, {
            sub: SUB,
            kind: "subscription_renewal",
            prefer: "card",
            attemptN: 1,
            now: new Date("2026-08-28T12:00:00.000Z"),
            fallbackSubStatus: "overdue",
            notifyWhatsApp: false,
        });

        assert.equal(res.ok, true);
        if (res.ok) {
            assert.equal(res.outcome, "pix_pending");
            assert.equal(res.orderId, "ord_pix");
        }
        assert.equal(fulfillCalls.length, 0);
        const attempts = db.tables.payment_attempts ?? [];
        assert.ok(attempts.some((a) => a.channel === "card" && a.status === "failed"));
        assert.ok(attempts.some((a) => a.channel === "pix" && a.status === "pending"));
        assert.ok(
            db.writes.some(
                (w) =>
                    w.table === "pagarme_subscriptions" &&
                    w.operation === "rpc_transition_billing_status"
            ),
            "fallback de status via RPC, não .update direto"
        );
        assert.equal(db.tables.pagarme_subscriptions?.[0]?.status, "overdue");
    });

    it("unique pending: reusa invoice existente sem criar outra", async () => {
        fulfillCalls = [];
        mockPagarme.createOrderWithSavedCard = async () => ({
            id: "ord_reuse",
            charges: [{ status: "paid" }],
        });
        mockPagarme.isOrderCreditPaid = () => true;

        const existingId = "inv-existing";
        const db = adminWithPending({
            id: existingId,
            subscription_id: SUB.id,
            status: "pending",
            pagarme_order_id: null,
            pix_qr_code: null,
        });

        const before = (db.tables.invoices ?? []).length;
        const res = await collectPayment(db.client as unknown as SupabaseClient, {
            sub: SUB,
            kind: "subscription_renewal",
            prefer: "card",
            attemptN: 1,
            now: new Date("2026-08-28T12:00:00.000Z"),
            fallbackSubStatus: "overdue",
            notifyWhatsApp: false,
        });

        assert.equal(res.ok, true);
        if (res.ok) {
            assert.equal(res.outcome, "paid_card");
            assert.equal(res.invoiceId, existingId);
        }
        assert.equal((db.tables.invoices ?? []).length, before, "não cria invoice duplicada");
    });
});
