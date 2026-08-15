import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    acceptedCustomerPaymentsFromCompanySettings,
    assertAtLeastOneCustomerPayment,
    assertCustomerPaymentAllowed,
    DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS,
    listEnabledCustomerPayments,
    normalizeAcceptedCustomerPayments,
} from "@/src/financeiro/domain/acceptedCustomerPayments";

describe("acceptedCustomerPayments", () => {
    it("defaults to pix/cash/card without debit", () => {
        assert.deepEqual(DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS, {
            pix: true,
            cash: true,
            card: true,
            debit: false,
        });
        assert.deepEqual(
            listEnabledCustomerPayments(DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS),
            ["cash", "pix", "card"]
        );
    });

    it("ignores legacy enabled_payments keys", () => {
        const p = acceptedCustomerPaymentsFromCompanySettings({
            enabled_payments: { pix: false, credit_card: true, voucher: true },
        });
        assert.equal(p.pix, true);
        assert.equal(p.card, true);
        assert.equal(p.debit, false);
    });

    it("reads accepted_customer_payments", () => {
        const p = acceptedCustomerPaymentsFromCompanySettings({
            accepted_customer_payments: { pix: true, cash: false, card: false, debit: true },
        });
        assert.deepEqual(listEnabledCustomerPayments(p), ["pix", "debit"]);
    });

    it("rejects empty policy and disallowed method", () => {
        const empty = normalizeAcceptedCustomerPayments({
            pix: false,
            cash: false,
            card: false,
            debit: false,
        });
        assert.equal(assertAtLeastOneCustomerPayment(empty).ok, false);
        const ok = assertCustomerPaymentAllowed(DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS, "pix");
        assert.equal(ok.ok, true);
        const bad = assertCustomerPaymentAllowed(DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS, "debit");
        assert.equal(bad.ok, false);
        if (!bad.ok) assert.equal(bad.error, "payment_not_accepted");
    });
});
