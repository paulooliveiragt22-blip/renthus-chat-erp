import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeMockAdmin } from "../helpers/mockSupabaseAdmin";
import {
    loadAiIncludedBudget,
    loadCommercialPlanPricing,
} from "../../lib/billing/loadCommercialPlanPricing";

describe("loadCommercialPlanPricing", () => {
    it("lê lista/anual/IA do RPC (10% da lista mensal)", async () => {
        const db = makeMockAdmin({
            plans: [
                {
                    key: "essencial",
                    price_cents: 30000,
                    price_year_cents: 288000,
                    yearly_discount_mode: "percent",
                    yearly_discount_value: 2000,
                },
                { key: "pro", price_cents: 34900, price_year_cents: 335040 },
                { key: "market", price_cents: 44900, price_year_cents: 431040 },
            ],
        });
        const map = await loadCommercialPlanPricing(db.client as never);
        assert.equal(map.get("essencial")?.price_cents, 30000);
        assert.equal(map.get("essencial")?.ai_included_cents, 3000);
        assert.equal(map.get("pro")?.ai_included_cents, 3490);
        assert.equal(map.get("market")?.ai_included_cents, 4490);
    });
});

describe("loadAiIncludedBudget", () => {
    it("usa price_cents do plano da company, não o catálogo TS", async () => {
        const db = makeMockAdmin({
            pagarme_subscriptions: [{ company_id: "co-1", plan: "pro" }],
            plans: [{ key: "pro", price_cents: 40000 }],
        });
        const cents = await loadAiIncludedBudget(db.client as never, "co-1");
        assert.equal(cents, 4000);
    });

    it("alias legado bot → essencial", async () => {
        const db = makeMockAdmin({
            pagarme_subscriptions: [{ company_id: "co-1", plan: "bot" }],
            plans: [{ key: "essencial", price_cents: 27900 }],
        });
        const cents = await loadAiIncludedBudget(db.client as never, "co-1");
        assert.equal(cents, 2790);
    });
});
