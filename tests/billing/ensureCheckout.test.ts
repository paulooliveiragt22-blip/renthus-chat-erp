import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveCheckoutStrategy, checkoutOrderLabels } from "../../lib/billing/ensureCheckout";
import { getMonthlyPriceCents } from "../../lib/billing/pagarme";

describe("resolveCheckoutStrategy (BN-05 setup=0)", () => {
    it("pending_setup legado cobra mensalidade em invoice (setup fee abolido)", () => {
        const s = resolveCheckoutStrategy("pending_setup", "essencial", null);
        assert.equal(s.kind, "invoice");
        assert.equal(s.isFirstPayment, true);
        assert.equal(s.metaType, "invoice");
        assert.equal(s.invoiceKind, "subscription");
        assert.equal(s.amountCents, getMonthlyPriceCents("essencial"));
    });

    it("pending_payment nunca pago → invoice mensal (não setup)", () => {
        const s = resolveCheckoutStrategy("pending_payment", "essencial", null);
        assert.equal(s.kind, "invoice");
        assert.equal(s.isFirstPayment, true);
        assert.equal(s.metaType, "invoice");
        assert.equal(s.amountCents, getMonthlyPriceCents("essencial"));
    });

    it("pending_payment já pago → invoice mensal renovação", () => {
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

    it("trial → invoice (setup=0)", () => {
        const s = resolveCheckoutStrategy("trial", "pro", null);
        assert.equal(s.kind, "invoice");
        assert.equal(s.isFirstPayment, false);
        assert.equal(s.amountCents, getMonthlyPriceCents("pro"));
    });

    it("overdue/active → invoice; amount do catálogo (não pending stale)", () => {
        const a = resolveCheckoutStrategy("active", "market", 197);
        const o = resolveCheckoutStrategy("overdue", "market", null);
        assert.equal(a.kind, "invoice");
        assert.equal(o.kind, "invoice");
        assert.equal(a.amountCents, getMonthlyPriceCents("market"));
        assert.equal(a.amountCents, 44900);
        assert.equal(a.amountCents, o.amountCents);
    });

    it("checkoutOrderLabels mensalidade (sem taxa de ativação)", () => {
        const setupLegacy = resolveCheckoutStrategy("pending_setup", "essencial", null);
        assert.match(checkoutOrderLabels(setupLegacy, "Essencial").description, /Mensalidade/);
        const inv = resolveCheckoutStrategy(
            "pending_payment",
            "essencial",
            null,
            "2026-09-01T00:00:00.000Z"
        );
        assert.match(checkoutOrderLabels(inv, "Essencial").description, /Mensalidade/);
    });
});
