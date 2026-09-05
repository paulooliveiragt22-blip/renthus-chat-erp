import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMemoryAdminListSnapshotStore } from "../../lib/offline/adapters/idbAdminListSnapshotStore";
import {
    mapCatalogEntriesToOrderVariants,
    searchOrderVariantsFromCatalogEntries,
} from "../../lib/offline/application/mapCatalogToOrderVariant";
import type { CatalogSnapshotEntry } from "../../lib/offline/ports/CatalogSnapshotStore";

function entry(
    partial: Partial<CatalogSnapshotEntry> & Pick<CatalogSnapshotEntry, "embalagemId" | "name" | "productId">
): CatalogSnapshotEntry {
    return {
        productId: partial.productId,
        embalagemId: partial.embalagemId,
        name: partial.name,
        precoVenda: partial.precoVenda ?? 10,
        sigla: partial.sigla ?? "UN",
        fatorConversao: partial.fatorConversao ?? 1,
        ean: partial.ean ?? null,
        codigoInterno: partial.codigoInterno ?? null,
        codigoInternoEmbalagem: partial.codigoInternoEmbalagem ?? null,
        salesCount: partial.salesCount ?? 0,
        categoryName: partial.categoryName ?? null,
        details: partial.details ?? null,
        volumeFormatado: partial.volumeFormatado ?? null,
    };
}

describe("P5a admin list snapshot store (memory)", () => {
    it("save/load por domínio com teto", async () => {
        const store = createMemoryAdminListSnapshotStore();
        await store.save({
            companyId: "c1",
            domain: "orders",
            savedAt: new Date().toISOString(),
            version: "v1",
            entryCount: 2,
            entries: [{ id: "o1" }, { id: "o2" }, { id: "o3" }],
        });
        // cap orders = 50 — 3 ok
        const loaded = await store.load<{ id: string }>("c1", "orders");
        assert.equal(loaded?.entryCount, 3);
        assert.equal(loaded?.entries[0]?.id, "o1");

        await store.clear("c1", "orders");
        assert.equal(await store.load("c1", "orders"), null);
    });
});

describe("P5a M2 map catalog → Variant Pedidos", () => {
    it("agrupa UN+CX do mesmo produto", () => {
        const variants = mapCatalogEntriesToOrderVariants([
            entry({
                productId: "p1",
                embalagemId: "u1",
                name: "Skol",
                sigla: "UN",
                precoVenda: 5,
            }),
            entry({
                productId: "p1",
                embalagemId: "c1",
                name: "Skol",
                sigla: "CX",
                precoVenda: 50,
                fatorConversao: 12,
            }),
        ]);
        assert.equal(variants.length, 1);
        assert.equal(variants[0]?.unit_embalagem_id, "u1");
        assert.equal(variants[0]?.case_embalagem_id, "c1");
        assert.equal(variants[0]?.has_case, true);
        assert.equal(variants[0]?.case_qty, 12);
    });

    it("busca por nome no snapshot", () => {
        const entries = [
            entry({ productId: "p1", embalagemId: "e1", name: "Cerveja Skol Lata", codigoInterno: "SK1" }),
            entry({ productId: "p2", embalagemId: "e2", name: "Refrigerante Cola" }),
        ];
        const hits = searchOrderVariantsFromCatalogEntries(entries, "skol");
        assert.equal(hits.length, 1);
        assert.equal(hits[0]?.products?.name, "Cerveja Skol Lata");
        assert.equal(searchOrderVariantsFromCatalogEntries(entries, "SK1").length, 1);
    });
});
