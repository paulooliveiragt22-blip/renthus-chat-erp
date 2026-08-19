import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    assertStorePaymentAllowed,
    DEFAULT_ACCEPTED_STORE_PAYMENTS,
    DEFAULT_ACCEPTED_STORE_PRAZO,
} from "@/src/financeiro/domain/storePaymentPolicy";

describe("storePaymentPolicy", () => {
    it("aceita pix/cash/card/debit quando habilitados", () => {
        const r = assertStorePaymentAllowed(
            DEFAULT_ACCEPTED_STORE_PAYMENTS,
            DEFAULT_ACCEPTED_STORE_PRAZO,
            "pix"
        );
        assert.equal(r.ok, true);
    });

    it("rejeita débito desabilitado", () => {
        const r = assertStorePaymentAllowed(
            { ...DEFAULT_ACCEPTED_STORE_PAYMENTS, debit: false },
            DEFAULT_ACCEPTED_STORE_PRAZO,
            "debit"
        );
        assert.equal(r.ok, false);
        if (!r.ok) assert.equal(r.error, "payment_not_accepted");
    });

    it("mapeia credit do PDV para credit_installment", () => {
        const r = assertStorePaymentAllowed(
            DEFAULT_ACCEPTED_STORE_PAYMENTS,
            DEFAULT_ACCEPTED_STORE_PRAZO,
            "credit"
        );
        assert.equal(r.ok, true);
        if (r.ok) assert.equal(r.method, "credit_installment");
    });

    it("rejeita prazo desabilitado", () => {
        const r = assertStorePaymentAllowed(
            DEFAULT_ACCEPTED_STORE_PAYMENTS,
            { ...DEFAULT_ACCEPTED_STORE_PRAZO, boleto: false },
            "boleto"
        );
        assert.equal(r.ok, false);
    });
});
