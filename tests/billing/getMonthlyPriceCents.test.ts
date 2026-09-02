import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMonthlyPriceCents } from "@/lib/billing/pagarme";

describe("getMonthlyPriceCents canônico (ADR-0004 B4)", () => {
    it("ignora MONTHLY_PRICE_BOT_CENTS legado e usa catálogo", () => {
        const prev = process.env.MONTHLY_PRICE_BOT_CENTS;
        process.env.MONTHLY_PRICE_BOT_CENTS = "29700";
        try {
            assert.equal(getMonthlyPriceCents("essencial"), 19700);
            assert.equal(getMonthlyPriceCents("market"), 39700);
            assert.equal(getMonthlyPriceCents("pro"), 27900);
        } finally {
            if (prev === undefined) delete process.env.MONTHLY_PRICE_BOT_CENTS;
            else process.env.MONTHLY_PRICE_BOT_CENTS = prev;
        }
    });
});
