/**
 * Snapshot de catálogo PDV (Perf-1). Implementação real na fase P1.
 */

export type CatalogSnapshotMeta = {
    companyId: string;
    version: string;
    savedAt: string;
    entryCount: number;
};

/** Projection enxuta — campos de venda, não o produto completo. */
export type CatalogSnapshotEntry = {
    productId: string;
    embalagemId: string;
    name: string;
    precoVenda: number;
    sigla: string | null;
    fatorConversao: number;
    ean: string | null;
    codigoInterno: string | null;
    codigoInternoEmbalagem: string | null;
};

export type CatalogSnapshot = CatalogSnapshotMeta & {
    entries: CatalogSnapshotEntry[];
};

export type CatalogSnapshotStore = {
    save(snapshot: CatalogSnapshot): Promise<void>;
    load(companyId: string): Promise<CatalogSnapshot | null>;
    clear(companyId: string): Promise<void>;
};
