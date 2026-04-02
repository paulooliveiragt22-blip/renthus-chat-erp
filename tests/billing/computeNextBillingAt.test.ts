import assert from "node:assert";
import { describe, it } from "node:test";
import { computeNextBillingAt } from "../../lib/billing/computeNextBillingAt";

describe("computeNextBillingAt", () => {
    it("adds one calendar month from paidAt", () => {
        const paid = new Date(2026, 0, 15, 12, 0, 0);
        const next = computeNextBillingAt(paid);
        assert.strictEqual(next.getMonth(), 1);
        assert.strictEqual(next.getDate(), 15);
    });

    it("handles month-end (Jan 31 → Feb 28 non-leap)", () => {
        const paid = new Date(2025, 0, 31, 12, 0, 0);
        const next = computeNextBillingAt(paid);
        assert.strictEqual(next.getMonth(), 1);
        assert.strictEqual(next.getDate(), 28);
    });
});
