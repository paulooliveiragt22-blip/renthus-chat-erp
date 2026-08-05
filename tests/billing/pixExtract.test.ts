import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    extractPixCode,
    extractPixUrl,
    isPixEmvPayload,
    type PagarmeOrder,
} from "../../lib/billing/pagarme";

describe("PIX extract (Pagar.me)", () => {
    it("isPixEmvPayload distingue EMV de URL Mundipagg", () => {
        assert.equal(isPixEmvPayload("00020126580014br.gov.bcb.pix0136abc"), true);
        assert.equal(isPixEmvPayload("https://digital.mundipagg.com/pix/abc"), false);
    });

    it("extractPixCode ignora URL em qr_code", () => {
        const order = {
            id: "o1",
            status: "pending",
            charges: [
                {
                    id: "c1",
                    status: "pending",
                    last_transaction: {
                        qr_code: "https://digital.mundipagg.com/pix/xyz",
                        qr_code_url: "https://digital.mundipagg.com/pix/xyz.png",
                    },
                },
            ],
        } satisfies PagarmeOrder;
        assert.equal(extractPixCode(order), null);
        assert.equal(extractPixUrl(order), "https://digital.mundipagg.com/pix/xyz.png");
    });

    it("extractPixCode retorna EMV e extractPixUrl usa qr_code se for http", () => {
        const emv = "00020126580014br.gov.bcb.pix01361234567890";
        const withEmv = {
            id: "o2",
            status: "pending",
            charges: [
                {
                    id: "c2",
                    status: "pending",
                    last_transaction: { qr_code: emv, qr_code_url: "https://cdn.example/qr.png" },
                },
            ],
        } satisfies PagarmeOrder;
        assert.equal(extractPixCode(withEmv), emv);
        assert.equal(extractPixUrl(withEmv), "https://cdn.example/qr.png");

        const urlOnly = {
            id: "o3",
            status: "pending",
            charges: [
                {
                    id: "c3",
                    status: "pending",
                    last_transaction: {
                        qr_code: "https://digital.mundipagg.com/pix/only",
                    },
                },
            ],
        } satisfies PagarmeOrder;
        assert.equal(extractPixCode(urlOnly), null);
        assert.equal(extractPixUrl(urlOnly), "https://digital.mundipagg.com/pix/only");
    });

    it("extractPixCode acha EMV aninhado quando qr_code é URL Mundipagg", () => {
        const emv = "00020126580014br.gov.bcb.pix0136nested-emv-payload-ok";
        const order = {
            id: "o4",
            status: "pending",
            charges: [
                {
                    id: "c4",
                    status: "pending",
                    last_transaction: {
                        qr_code: "https://digital.mundipagg.com/pix/xyz",
                        qr_code_url: "https://digital.mundipagg.com/pix/xyz.png",
                        gateway_response: { emv },
                    },
                },
            ],
        } as unknown as PagarmeOrder;
        assert.equal(extractPixCode(order), emv);
    });
});
