import {
    CATALOG_SNAPSHOT_MAX_ENTRIES,
    isCatalogSnapshotStale,
} from "../adapters/idbCatalogSnapshotStore";
import { mapPdvApiRowToSnapshotEntry } from "./mapPdvRowToSnapshot";
import type { CatalogSnapshot, CatalogSnapshotEntry } from "../ports/CatalogSnapshotStore";
import type { CatalogSnapshotStore } from "../ports/CatalogSnapshotStore";
import { patchSyncStatus } from "../syncStatusStore";

/**
 * Baixa páginas do catálogo e grava no IDB (online).
 */
export async function hydrateCatalogSnapshotFromApi(
    store: CatalogSnapshotStore,
    companyId: string
): Promise<CatalogSnapshot> {
    const all: CatalogSnapshotEntry[] = [];
    let offset = 0;
    const pageSize = 500;
    let version = new Date().toISOString();

    while (all.length < CATALOG_SNAPSHOT_MAX_ENTRIES) {
        const res = await fetch(
            `/api/admin/pdv/catalog-snapshot?offset=${offset}&limit=${pageSize}`,
            { credentials: "include", cache: "no-store" }
        );
        const json = (await res.json().catch(() => ({}))) as {
            error?: string;
            entries?: CatalogSnapshotEntry[];
            version?: string;
            truncated?: boolean;
            entryCount?: number;
        };
        if (!res.ok) throw new Error(json.error ?? "catalog_snapshot_failed");

        const page = Array.isArray(json.entries) ? json.entries : [];
        if (json.version) version = json.version;
        all.push(...page);
        if (page.length < pageSize || json.truncated) break;
        offset += page.length;
    }

    const snapshot: CatalogSnapshot = {
        companyId,
        version,
        savedAt: new Date().toISOString(),
        entryCount: all.length,
        entries: all,
    };
    await store.save(snapshot);
    patchSyncStatus({ catalogStale: isCatalogSnapshotStale(snapshot.savedAt) });
    return snapshot;
}

export function snapshotEntryToPdvVariantShape(e: CatalogSnapshotEntry): Record<string, unknown> {
    return {
        id: e.embalagemId,
        produto_id: e.productId,
        product_name: e.name,
        category_name: e.categoryName,
        sigla_comercial: e.sigla,
        sigla_humanizada: e.siglaHumanizada ?? e.sigla,
        volume_formatado: e.volumeFormatado,
        fator_conversao: e.fatorConversao,
        preco_venda: e.precoVenda,
        codigo_interno: e.codigoInterno,
        codigo_barras_ean: e.ean,
        descricao: e.details,
        sales_count: e.salesCount ?? 0,
        vender_com_estoque_zero: e.venderComEstoqueZero !== false,
    };
}

export { mapPdvApiRowToSnapshotEntry };
