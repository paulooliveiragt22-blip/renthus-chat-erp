import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildCatalogSearchIndex,
    lookupCatalogExact,
    searchCatalogByName,
} from "../../lib/offline/application/buildCatalogSearchIndex";
import { projectCatalogEntries } from "../../lib/offline/adapters/idbCatalogSnapshotStore";
import type { CatalogSnapshotEntry } from "../../lib/offline/ports/CatalogSnapshotStore";
import { getDefaultSyncEligibilityLimits } from "../../lib/offline/domain/SyncEligibility";

function entry(partial: Partial<CatalogSnapshotEntry> & Pick<CatalogSnapshotEntry, "embalagemId" | "name">): CatalogSnapshotEntry {
    return {
        productId: partial.productId ?? "p1",
        embalagemId: partial.embalagemId,
        name: partial.name,
        precoVenda: partial.precoVenda ?? 10,
        sigla: partial.sigla ?? "UN",
        fatorConversao: partial.fatorConversao ?? 1,
        ean: partial.ean ?? null,
        codigoInterno: partial.codigoInterno ?? null,
        codigoInternoEmbalagem: partial.codigoInternoEmbalagem ?? null,
        salesCount: partial.salesCount ?? 0,
    };
}

describe("offline catalog search index", () => {
    it("lookup exact por EAN e código", () => {
        const idx = buildCatalogSearchIndex([
            entry({ embalagemId: "e1", name: "Skol 350", ean: "789123", codigoInterno: "SK01" }),
            entry({ embalagemId: "e2", name: "Brahma 600", ean: "789999", codigoInterno: "BR01" }),
        ]);
        assert.equal(lookupCatalogExact(idx, "789123")?.embalagemId, "e1");
        assert.equal(lookupCatalogExact(idx, "SK01")?.embalagemId, "e1");
        assert.equal(lookupCatalogExact(idx, "nope"), null);
    });

    it("busca por nome com tokens", () => {
        const idx = buildCatalogSearchIndex([
            entry({ embalagemId: "e1", name: "Cerveja Skol Lata", salesCount: 2 }),
            entry({ embalagemId: "e2", name: "Cerveja Brahma Garrafa", salesCount: 9 }),
        ]);
        const hits = searchCatalogByName(idx, "skol");
        assert.equal(hits.length, 1);
        assert.equal(hits[0]?.embalagemId, "e1");
    });

    it("projectCatalogEntries respeita teto", () => {
        const many = Array.from({ length: 10 }, (_, i) =>
            entry({ embalagemId: `e${i}`, name: `P${i}` })
        );
        const cut = projectCatalogEntries(many, 3);
        assert.equal(cut.length, 3);
    });
});

describe("offline SyncEligibility limits D-P3", () => {
    it("default 24h / 200", () => {
        const lim = getDefaultSyncEligibilityLimits();
        assert.equal(lim.maxPendingCommands, 200);
        assert.equal(lim.maxCommandAgeMs, 24 * 60 * 60 * 1000);
    });
});
