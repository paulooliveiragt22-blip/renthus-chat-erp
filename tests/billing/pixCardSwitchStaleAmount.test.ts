import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
    return readFileSync(join(root, rel), "utf8");
}

describe("PIX→cartão — amount/stale QR", () => {
    it("loadCheckoutContext não cancela order (só fulfill se paid)", () => {
        const src = read("lib/billing/ensureCheckout.ts");
        assert.match(src, /fulfillIfPagarmeOrderPaid/);
        assert.doesNotMatch(
            src,
            /reconcileOrCancelLiveOrder/
        );
        assert.match(src, /priorAmountCents !== chargeCents/);
        assert.match(src, /cancelPagarmeChargeBestEffort/);
    });

    it("create-invoice-checkout valida amount antes de reusar PIX", () => {
        const src = read("app/api/billing/create-invoice-checkout/route.ts");
        assert.match(src, /isReusableOpenOrderForAmount/);
        assert.match(src, /clearPendingInvoicePspFields/);
        assert.doesNotMatch(
            src,
            /Já tem order \+ EMV: reutiliza/
        );
    });

    it("UI limpa pixLive ao trocar para cartão", () => {
        const src = read("components/billing/PlanBillingPanel.tsx");
        assert.match(src, /mode === "card"/);
        assert.match(src, /setPixLiveCode\(null\)/);
        assert.match(src, /setPixLiveUrl\(null\)/);
    });

    it("isReusableOpenOrderForAmount existe e exige amount match", () => {
        const src = read("lib/billing/pagarme.ts");
        assert.match(src, /export function isReusableOpenOrderForAmount/);
        assert.match(src, /extractOrderAmountCents/);
        assert.match(src, /amt === Math\.floor\(expectedAmountCents\)/);
    });
});
