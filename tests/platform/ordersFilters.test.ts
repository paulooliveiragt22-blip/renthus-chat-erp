import assert from "node:assert";
import { describe, it } from "node:test";
import {
    defaultOrdersFilter,
    ordersFilterQueryString,
    parseOrdersFilterFromSearchParams,
    REVENUE_STATUSES_WHEN_ALL,
} from "../../lib/platform/ordersFilters";

describe("platform orders filters", () => {
    it("default is status=all, company=all, current month → today", () => {
        const f = defaultOrdersFilter();
        assert.strictEqual(f.status, "all");
        assert.strictEqual(f.companyId, "all");
        assert.notStrictEqual(f.dateFrom, "all");
        assert.notStrictEqual(f.dateTo, "all");
        assert.match(f.dateFrom, /^\d{4}-\d{2}-\d{2}$/);
        assert.match(f.dateTo, /^\d{4}-\d{2}-\d{2}$/);
    });

    it("serializes all four fields including explicit all", () => {
        const q = ordersFilterQueryString({
            status: "all",
            dateFrom: "all",
            dateTo: "all",
            companyId: "all",
        });
        const sp = new URLSearchParams(q);
        assert.strictEqual(sp.get("status"), "all");
        assert.strictEqual(sp.get("date_from"), "all");
        assert.strictEqual(sp.get("date_to"), "all");
        assert.strictEqual(sp.get("company_id"), "all");
    });

    it("round-trips date=all without falling back to month default", () => {
        const q = ordersFilterQueryString({
            status: "finalized",
            dateFrom: "all",
            dateTo: "all",
            companyId: "abc",
        });
        const parsed = parseOrdersFilterFromSearchParams(new URLSearchParams(q));
        assert.deepStrictEqual(parsed, {
            status: "finalized",
            dateFrom: "all",
            dateTo: "all",
            companyId: "abc",
        });
    });

    it("missing query params use month default (not all-time)", () => {
        const parsed = parseOrdersFilterFromSearchParams(new URLSearchParams());
        const defaults = defaultOrdersFilter();
        assert.strictEqual(parsed.status, "all");
        assert.strictEqual(parsed.companyId, "all");
        assert.strictEqual(parsed.dateFrom, defaults.dateFrom);
        assert.strictEqual(parsed.dateTo, defaults.dateTo);
    });

    it("revenue when status=all excludes canceled", () => {
        assert.ok(!REVENUE_STATUSES_WHEN_ALL.includes("canceled"));
        assert.ok(REVENUE_STATUSES_WHEN_ALL.includes("finalized"));
        assert.ok(REVENUE_STATUSES_WHEN_ALL.includes("new"));
    });
});
