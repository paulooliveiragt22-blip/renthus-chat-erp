import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    parseMenuAnalyticsRpc,
    resolveAnalyticsRange,
} from "../../lib/public-menu/parseMenuAnalytics";

describe("parseMenuAnalytics", () => {
    it("mapeia jsonb snake_case para camelCase", () => {
        const parsed = parseMenuAnalyticsRpc({
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-08-04T00:00:00.000Z",
            page_views: 12,
            unique_visitors: 5,
            product_views: 3,
            days: [{ date: "2026-08-03", page_views: 4, unique_visitors: 2 }],
            top_products: [{ product_id: "p1", name: "Água", views: 3 }],
            utm_sources: [{ utm_source: "whatsapp", page_views: 8, unique_visitors: 4 }],
        });
        assert.ok(parsed);
        assert.equal(parsed!.pageViews, 12);
        assert.equal(parsed!.uniqueVisitors, 5);
        assert.equal(parsed!.topProducts[0]!.name, "Água");
        assert.equal(parsed!.utmSources[0]!.utmSource, "whatsapp");
        assert.equal(parsed!.days[0]!.date, "2026-08-03");
    });

    it("resolve dias padrão 30 e aceita 7/90", () => {
        assert.equal(resolveAnalyticsRange(null).days, 30);
        assert.equal(resolveAnalyticsRange("7").days, 7);
        assert.equal(resolveAnalyticsRange("90").days, 90);
        assert.equal(resolveAnalyticsRange("11").days, 30);
    });
});
