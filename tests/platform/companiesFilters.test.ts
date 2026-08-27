import assert from "node:assert";
import { describe, it } from "node:test";
import {
    companiesFilterQueryString,
    companiesOptionsQueryString,
    defaultCompaniesFilter,
    parseCompaniesFilterFromSearchParams,
} from "../../lib/platform/companiesFilters";

describe("platform companies filters", () => {
    it("default is all dates, account=all, sort created_at", () => {
        const f = defaultCompaniesFilter();
        assert.strictEqual(f.account, "all");
        assert.strictEqual(f.datePreset, "all");
        assert.strictEqual(f.dateFrom, "all");
        assert.strictEqual(f.dateTo, "all");
        assert.strictEqual(f.sort, "created_at");
        assert.strictEqual(f.planId, "all");
        assert.strictEqual(f.wa, "all");
    });

    it("options query keeps date_preset=all for dropdowns", () => {
        const sp = new URLSearchParams(companiesOptionsQueryString());
        assert.strictEqual(sp.get("date_preset"), "all");
        assert.strictEqual(sp.get("account"), "all");
    });

    it("round-trips suspended + 30d + plan", () => {
        const q = companiesFilterQueryString({
            ...defaultCompaniesFilter(),
            account: "suspended",
            datePreset: "30d",
            dateFrom: "2026-07-28",
            dateTo: "2026-08-27",
            planId: "plan-1",
            subStatus: "trial",
            onboarding: "pending",
            wa: "none",
            cidade: "Sinop",
            uf: "MT",
            q: "abc",
            sort: "order_count",
        });
        const parsed = parseCompaniesFilterFromSearchParams(
            new URLSearchParams(q)
        );
        assert.strictEqual(parsed.account, "suspended");
        assert.strictEqual(parsed.datePreset, "30d");
        assert.strictEqual(parsed.planId, "plan-1");
        assert.strictEqual(parsed.subStatus, "trial");
        assert.strictEqual(parsed.onboarding, "pending");
        assert.strictEqual(parsed.wa, "none");
        assert.strictEqual(parsed.cidade, "Sinop");
        assert.strictEqual(parsed.uf, "MT");
        assert.strictEqual(parsed.q, "abc");
        assert.strictEqual(parsed.sort, "order_count");
    });
});
