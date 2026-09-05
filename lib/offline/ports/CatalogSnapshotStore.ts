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
    /** Código interno da embalagem (mesmo campo view quando unificado). */
    codigoInternoEmbalagem: string | null;
    /** D-P2: espelho de products.vender_com_estoque_zero (default true). */
    venderComEstoqueZero?: boolean;
    categoryName?: string | null;
    details?: string | null;
    siglaHumanizada?: string | null;
    volumeFormatado?: string | null;
    salesCount?: number;
};

export type CatalogSnapshot = CatalogSnapshotMeta & {
    entries: CatalogSnapshotEntry[];
};

export type CatalogSnapshotStore = {
    save(snapshot: CatalogSnapshot): Promise<void>;
    load(companyId: string): Promise<CatalogSnapshot | null>;
    clear(companyId: string): Promise<void>;
};
