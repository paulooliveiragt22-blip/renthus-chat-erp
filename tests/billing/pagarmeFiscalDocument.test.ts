import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    applyFiscalToPagarmeCustomer,
    PAGARME_SANDBOX_CNPJ,
    resolvePagarmeFiscalDocument,
} from "../../lib/billing/pagarmeFiscalDocument";

describe("pagarmeFiscalDocument", () => {
    it("keeps a valid company CNPJ", () => {
        const r = resolvePagarmeFiscalDocument("11444777000161", { sandbox: false });
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.value.digits, "11444777000161");
        assert.equal(r.value.usedSandboxFixture, false);
        assert.equal(r.value.document_type, "CNPJ");
    });

    it("rejects invalid CNPJ on live", () => {
        const r = resolvePagarmeFiscalDocument("02856659000125", { sandbox: false });
        assert.equal(r.ok, false);
    });

    it("substitutes sandbox fixture when company CNPJ is invalid", () => {
        const r = resolvePagarmeFiscalDocument("02856659000125", { sandbox: true });
        assert.equal(r.ok, true);
        if (!r.ok) return;
        assert.equal(r.value.digits, PAGARME_SANDBOX_CNPJ);
        assert.equal(r.value.usedSandboxFixture, true);
        const customer = applyFiscalToPagarmeCustomer(
            {
                name: "Loja",
                email: "a@b.com",
                type: "company" as const,
                document: undefined as string | undefined,
                document_type: undefined as "CPF" | "CNPJ" | undefined,
            },
            r.value
        );
        assert.equal(customer.document, PAGARME_SANDBOX_CNPJ);
        assert.equal(customer.document_type, "CNPJ");
    });
});
