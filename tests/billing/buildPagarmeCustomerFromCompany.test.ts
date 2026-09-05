import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPagarmeCustomerPayload } from "../../lib/billing/buildPagarmeCustomerFromCompany";

describe("buildPagarmeCustomerPayload", () => {
    it("omits invalid CNPJ so Pagar.me does not receive document_type CNPJ", () => {
        const p = buildPagarmeCustomerPayload({
            id: "0146656e-7faf-42c6-aaee-52d54bf76680",
            name: "varavagio food",
            email: "vfood@gmail.com",
            whatsapp_phone: null,
            cnpj: "02856659000125",
        });
        assert.equal(p.document, undefined);
        assert.equal(p.document_type, undefined);
        assert.equal(p.type, "company");
    });

    it("sends checksum-valid CNPJ", () => {
        const p = buildPagarmeCustomerPayload({
            id: "co-1",
            name: "Loja",
            email: "a@b.com",
            whatsapp_phone: null,
            cnpj: "11444777000161",
        });
        assert.equal(p.document, "11444777000161");
        assert.equal(p.document_type, "CNPJ");
    });
});
