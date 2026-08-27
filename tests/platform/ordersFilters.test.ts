import assert from "node:assert";
import { describe, it } from "node:test";
import {
    applyDatePreset,
    defaultOrdersFilter,
    ordersFilterQueryString,
    parseOrdersFilterFromSearchParams,
    rangeForLastDays,
    REVENUE_STATUSES_WHEN_ALL,
} from "../../lib/platform/ordersFilters";

describe("platform orders filters", () => {
    it("default is status=all, company=all, preset 30d", () => {
        const f = defaultOrdersFilter();
        assert.strictEqual(f.status, "all");
        assert.strictEqual(f.companyId, "all");
        assert.strictEqual(f.datePreset, "30d");
        assert.notStrictEqual(f.dateFrom, "all");
        assert.notStrictEqual(f.dateTo, "all");
        const expected = rangeForLastDays(30);
        assert.strictEqual(f.dateFrom, expected.from);
        assert.strictEqual(f.dateTo, expected.to);
    });

    it("applyDatePreset covers 7/14/30/60/90 and all", () => {
        for (const days of [7, 14, 30, 60, 90] as const) {
            const preset = `${days}d` as const;
            const applied = applyDatePreset(preset);
            assert.strictEqual(applied.datePreset, preset);
            assert.deepStrictEqual(
                { from: applied.dateFrom, to: applied.dateTo },
                rangeForLastDays(days)
            );
        }
        assert.deepStrictEqual(applyDatePreset("all"), {
            datePreset: "all",
            dateFrom: "all",
            dateTo: "all",
        });
    });

    it("serializes date_preset and explicit all", () => {
        const q = ordersFilterQueryString({
            status: "all",
            datePreset: "all",
            dateFrom: "all",
            dateTo: "all",
            companyId: "all",
        });
        const sp = new URLSearchParams(q);
        assert.strictEqual(sp.get("status"), "all");
        assert.strictEqual(sp.get("date_preset"), "all");
        assert.strictEqual(sp.get("date_from"), "all");
        assert.strictEqual(sp.get("date_to"), "all");
        assert.strictEqual(sp.get("company_id"), "all");
    });

    it("round-trips preset 7d and date=all", () => {
        const q7 = ordersFilterQueryString({
            status: "all",
            ...applyDatePreset("7d"),
            companyId: "all",
        });
        const p7 = parseOrdersFilterFromSearchParams(new URLSearchParams(q7));
        assert.strictEqual(p7.datePreset, "7d");
        assert.deepStrictEqual(
            { from: p7.dateFrom, to: p7.dateTo },
            rangeForLastDays(7)
        );

        const qAll = ordersFilterQueryString({
            status: "finalized",
            datePreset: "all",
            dateFrom: "all",
            dateTo: "all",
            companyId: "abc",
        });
        const parsed = parseOrdersFilterFromSearchParams(new URLSearchParams(qAll));
        assert.deepStrictEqual(parsed, {
            status: "finalized",
            datePreset: "all",
            dateFrom: "all",
            dateTo: "all",
            companyId: "abc",
        });
    });

    it("missing query params use 30d default", () => {
        const parsed = parseOrdersFilterFromSearchParams(new URLSearchParams());
        const defaults = defaultOrdersFilter();
        assert.strictEqual(parsed.status, "all");
        assert.strictEqual(parsed.companyId, "all");
        assert.strictEqual(parsed.datePreset, "30d");
        assert.strictEqual(parsed.dateFrom, defaults.dateFrom);
        assert.strictEqual(parsed.dateTo, defaults.dateTo);
    });

    it("revenue when status=all excludes canceled", () => {
        assert.ok(!REVENUE_STATUSES_WHEN_ALL.includes("canceled"));
        assert.ok(REVENUE_STATUSES_WHEN_ALL.includes("finalized"));
        assert.ok(REVENUE_STATUSES_WHEN_ALL.includes("new"));
    });
});
