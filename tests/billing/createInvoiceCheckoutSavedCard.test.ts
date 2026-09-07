import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const root = process.cwd();

function read(rel: string): string {
    return readFileSync(join(root, rel), "utf8");
}

describe("create-invoice-checkout — saved card wallet", () => {
    it("não descarta walletCustomerId quando PATCH do customer falha", () => {
        const src = read("app/api/billing/create-invoice-checkout/route.ts");
        assert.match(src, /walletCustomerId/);
        assert.match(src, /createOrderWithSavedCard\([\s\S]*customerId:\s*walletCustomerId/);
        // Regressão: zerar o id da carteira no catch do PATCH quebrava "Usar este cartão".
        assert.doesNotMatch(
            src,
            /PATCH customer document failed:[\s\S]{0,120}pagarmeCustomerId\s*=\s*undefined/
        );
        assert.doesNotMatch(
            src,
            /Cliente Pagar\.me ausente ou com documento inválido\. Cadastre um cartão novo\./
        );
    });

    it("cartão novo: PSP via createCustomer+createCustomerCard+card_id (não createSetupOrder/card_token)", () => {
        const src = read("app/api/billing/create-invoice-checkout/route.ts");
        assert.match(src, /createCustomerCard/);
        assert.match(src, /createCustomer\(/);
        assert.match(src, /isPagarmeOrderTerminalFailed/);
        assert.match(src, /card_payment_failed/);
        assert.doesNotMatch(src, /createSetupOrder/);
    });
});
