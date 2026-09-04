import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { proratePlanUpgradeCents } from "@/lib/billing/proratePlanUpgrade";

describe("proratePlanUpgradeCents", () => {
    it("15/30 dias: delta 10000 → 5000", () => {
        const now = new Date("2026-09-04T12:00:00Z");
        const next = new Date("2026-09-19T12:00:00Z"); // 15d
        assert.equal(proratePlanUpgradeCents(34900, 44900, next, now, 30), 5000);
    });

    it("delta zero ou negativo → 0", () => {
        const now = new Date();
        const next = new Date(Date.now() + 10 * 86_400_000);
        assert.equal(proratePlanUpgradeCents(44900, 34900, next, now, 30), 0);
    });
});
