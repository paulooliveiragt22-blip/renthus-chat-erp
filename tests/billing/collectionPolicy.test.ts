import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    resolveCollectionAction,
    resolveTrialDueKind,
} from "../../lib/billing/collectionPolicy";

describe("resolveCollectionAction", () => {
    it("D0 com cartão → collect card", () => {
        const a = resolveCollectionAction({
            daysOverdue: 0,
            hasDefaultCard: true,
            hasPendingInvoice: false,
        });
        assert.deepEqual(a, { type: "collect", prefer: "card", attemptLabel: "d0" });
    });

    it("D0 sem cartão → collect pix", () => {
        const a = resolveCollectionAction({
            daysOverdue: 0,
            hasDefaultCard: false,
            hasPendingInvoice: false,
        });
        assert.deepEqual(a, { type: "collect", prefer: "pix", attemptLabel: "d0" });
    });

    it("D1 com cartão → retry card", () => {
        const a = resolveCollectionAction({
            daysOverdue: 1,
            hasDefaultCard: true,
            hasPendingInvoice: true,
        });
        assert.deepEqual(a, { type: "collect", prefer: "card", attemptLabel: "d1" });
    });

    it("D1 sem cartão → notify_only", () => {
        const a = resolveCollectionAction({
            daysOverdue: 1,
            hasDefaultCard: false,
            hasPendingInvoice: true,
        });
        assert.deepEqual(a, { type: "notify_only", day: 1 });
    });

    it("D3 com cartão → retry card", () => {
        const a = resolveCollectionAction({
            daysOverdue: 3,
            hasDefaultCard: true,
            hasPendingInvoice: true,
        });
        assert.deepEqual(a, { type: "collect", prefer: "card", attemptLabel: "d3" });
    });

    it("D2 → noop", () => {
        const a = resolveCollectionAction({
            daysOverdue: 2,
            hasDefaultCard: true,
            hasPendingInvoice: true,
        });
        assert.equal(a.type, "noop");
    });

    it("D5 com cartão → retry card (BN-13)", () => {
        const a = resolveCollectionAction({
            daysOverdue: 5,
            hasDefaultCard: true,
            hasPendingInvoice: true,
        });
        assert.deepEqual(a, { type: "collect", prefer: "card", attemptLabel: "d5" });
    });

    it("D5 sem cartão → notify_only", () => {
        const a = resolveCollectionAction({
            daysOverdue: 5,
            hasDefaultCard: false,
            hasPendingInvoice: true,
        });
        assert.deepEqual(a, { type: "notify_only", day: 5 });
    });

    it("D6 → noop (não bloqueia antes de D7)", () => {
        const a = resolveCollectionAction({
            daysOverdue: 6,
            hasDefaultCard: true,
            hasPendingInvoice: true,
        });
        assert.equal(a.type, "noop");
    });

    it("D7+ → block (BN-13)", () => {
        assert.equal(
            resolveCollectionAction({
                daysOverdue: 7,
                hasDefaultCard: true,
                hasPendingInvoice: true,
            }).type,
            "block"
        );
        assert.equal(
            resolveCollectionAction({
                daysOverdue: 9,
                hasDefaultCard: false,
                hasPendingInvoice: true,
            }).type,
            "block"
        );
    });
});

describe("resolveTrialDueKind", () => {
    it("setup=0 → first_invoice", () => {
        assert.equal(resolveTrialDueKind(0), "first_invoice");
    });
    it("setup>0 → setup", () => {
        assert.equal(resolveTrialDueKind(9900), "setup");
    });
});
