import assert from "node:assert/strict";
import { describe, it, beforeEach } from "node:test";
import {
    catalogSearchCacheKey,
    getCachedCatalogSearch,
    setCachedCatalogSearch,
    invalidateCatalogSearchCache,
    resetCatalogSearchCacheForTests,
} from "../../lib/chatbot/pro/catalogSearchCache";

describe("catalogSearchCache", () => {
    beforeEach(() => {
        resetCatalogSearchCacheForTests();
        process.env.CHATBOT_CATALOG_CACHE_TTL_SEC = "60";
    });

    it("round-trip get/set", () => {
        const key = catalogSearchCacheKey({
            companyId: "c1",
            query: "brahma",
            limit: 8,
        });
        setCachedCatalogSearch(key, {
            items: [{ id: "1", product_name: "Brahma", descricao: null, sigla_comercial: "UN", preco_venda: 5, volume_quantidade: null, unit_type_sigla: null, fator_conversao: 1, product_volume_id: null, category_id: null }],
            didYouMean: [],
            empty: false,
            queryNormalized: "brahma",
        });
        const hit = getCachedCatalogSearch(key);
        assert.ok(hit);
        assert.equal(hit.items[0]?.product_name, "Brahma");
    });

    it("invalidate por company", () => {
        const k1 = catalogSearchCacheKey({ companyId: "a", query: "x", limit: 8 });
        const k2 = catalogSearchCacheKey({ companyId: "b", query: "x", limit: 8 });
        setCachedCatalogSearch(k1, {
            items: [],
            didYouMean: [],
            empty: true,
            queryNormalized: "x",
        });
        setCachedCatalogSearch(k2, {
            items: [],
            didYouMean: [],
            empty: true,
            queryNormalized: "x",
        });
        invalidateCatalogSearchCache("a");
        assert.equal(getCachedCatalogSearch(k1), null);
        assert.ok(getCachedCatalogSearch(k2));
    });
});
