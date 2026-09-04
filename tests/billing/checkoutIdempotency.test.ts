import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    BILLING_CHECKOUT_IDEMPOTENCY_TTL_MS,
    isCheckoutIdempotencyFresh,
} from "@/lib/billing/checkoutIdempotency";

describe("isCheckoutIdempotencyFresh", () => {
    const now = Date.parse("2026-09-04T12:00:00.000Z");

    it("true dentro de 7 dias", () => {
        const created = new Date(now - BILLING_CHECKOUT_IDEMPOTENCY_TTL_MS + 60_000).toISOString();
        assert.equal(isCheckoutIdempotencyFresh(created, now), true);
    });

    it("false após TTL", () => {
        const created = new Date(now - BILLING_CHECKOUT_IDEMPOTENCY_TTL_MS - 1).toISOString();
        assert.equal(isCheckoutIdempotencyFresh(created, now), false);
    });

    it("false sem created_at / inválido", () => {
        assert.equal(isCheckoutIdempotencyFresh(null, now), false);
        assert.equal(isCheckoutIdempotencyFresh("not-a-date", now), false);
    });
});
