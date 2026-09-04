import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { resolveCheckoutStrategy, checkoutOrderLabels } from "../../lib/billing/ensureCheckout";
import { getMonthlyPriceCents } from "../../lib/billing/pagarme";

describe("resolveCheckoutStrategy (B3.6)", () => {
    const prev = { ...process.env };

    afterEach(() => {
        process.env = { ...prev };
    });

    it("pending_setup legado com SETUP=0 cobra mensalidade em invoice", () => {
        process.env.SETUP_PRICE_ESSENCIAL_CENTS = "0";
        const s = resolveCheckoutStrategy("pending_setup", "essencial", null);
        assert.equal(s.kind, "invoice");
        assert.equal(s.isFirstPayment, true);
        assert.equal(s.metaType, "invoice");
        assert.equal(s.invoiceKind, "subscription");
    });

    it("pending_payment nunca pago → setup quando configurado", () => {
        process.env.SETUP_PRICE_ESSENCIAL_CENTS = "49700";
        const s = resolveCheckoutStrategy("pending_payment", "essencial", null);
        assert.equal(s.kind, "setup");
        assert.equal(s.isFirstPayment, true);
        assert.equal(s.metaType, "setup");
        assert.equal(s.amountCents, 49700);
    });

    it("pending_payment já pago → invoice mensal", () => {
        process.env.SETUP_PRICE_ESSENCIAL_CENTS = "49700";
        const s = resolveCheckoutStrategy(
            "pending_payment",
            "essencial",
            null,
            "2026-09-01T00:00:00.000Z"
        );
        assert.equal(s.kind, "invoice");
        assert.equal(s.isFirstPayment, false);
        assert.equal(s.metaType, "invoice");
    });

    it("pending_payment nunca pago com setup zero continua primeiro pagamento mensal", () => {
        process.env.SETUP_PRICE_ESSENCIAL_CENTS = "0";
        const s = resolveCheckoutStrategy("pending_payment", "essencial", null);
        assert.equal(s.isFirstPayment, true);
        assert.equal(s.kind, "invoice");
        assert.equal(s.invoiceKind, "subscription");
    });

    it("trial + setup>0 → setup", () => {
        process.env.SETUP_PRICE_PRO_CENTS = "10000";
        const s = resolveCheckoutStrategy("trial", "pro", null);
        assert.equal(s.kind, "setup");
        assert.equal(s.isFirstPayment, true);
    });

    it("trial + setup=0 → invoice", () => {
        process.env.SETUP_PRICE_ESSENCIAL_CENTS = "0";
        process.env.SETUP_PRICE_BOT_CENTS = "0";
        const s = resolveCheckoutStrategy("trial", "essencial", null);
        assert.equal(s.kind, "invoice");
        assert.equal(s.isFirstPayment, false);
    });

    it("overdue/active → invoice (renovação); amount do catálogo (não pending stale)", () => {
        const a = resolveCheckoutStrategy("active", "market", 197);
        const o = resolveCheckoutStrategy("overdue", "market", null);
        assert.equal(a.kind, "invoice");
        assert.equal(o.kind, "invoice");
        // H4.3: pending 197 BRL não sobrescreve catálogo
        assert.equal(a.amountCents, getMonthlyPriceCents("market"));
        assert.equal(a.amountCents, o.amountCents);
    });

    it("checkoutOrderLabels alinhado", () => {
        process.env.SETUP_PRICE_ESSENCIAL_CENTS = "49700";
        const setup = resolveCheckoutStrategy("pending_setup", "essencial", null);
        assert.match(checkoutOrderLabels(setup, "Essencial").description, /Taxa de ativação/);
        const inv = resolveCheckoutStrategy(
            "pending_payment",
            "essencial",
            null,
            "2026-09-01T00:00:00.000Z"
        );
        assert.match(checkoutOrderLabels(inv, "Essencial").description, /Mensalidade/);
    });
});
