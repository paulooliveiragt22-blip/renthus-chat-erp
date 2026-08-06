import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLAN_CATALOG } from "@/lib/billing/planCatalog";

describe("PLAN_CATALOG Market lançamento", () => {
    it("Market custa R$ 397 e não inclui mobile_app", () => {
        assert.equal(PLAN_CATALOG.market.monthlyPriceCents, 39700);
        assert.equal(PLAN_CATALOG.market.aiIncludedCents, 3970);
        assert.ok(PLAN_CATALOG.market.features.includes("table_service"));
        assert.ok(PLAN_CATALOG.market.features.includes("omnichannel_ig_messenger"));
        assert.ok(!PLAN_CATALOG.market.features.includes("mobile_app"));
    });
});
