/**
 * Contratos de sync de cardápio marketplace (F1 — iFood / Aiqfome).
 * Ports tipados; adapters concretos entram depois das credenciais.
 */

export type MarketplaceProvider = "ifood" | "aiqfome";

export type MarketplaceConnectionStatus =
    | "disconnected"
    | "connected"
    | "error"
    | "syncing";

export interface MarketplaceConnection {
    companyId: string;
    provider: MarketplaceProvider;
    merchantId: string;
    status: MarketplaceConnectionStatus;
    lastSyncAt: string | null;
    lastError: string | null;
}

/** Item normalizado vindo do catálogo externo (antes do upsert Renthus). */
export interface MarketplaceCatalogItem {
    provider: MarketplaceProvider;
    externalItemId: string;
    externalProductId: string | null;
    externalCategoryId: string | null;
    categoryName: string;
    name: string;
    description: string | null;
    price: number;
    currency: "BRL";
    imageUrl: string | null;
    available: boolean;
    externalCode: string | null;
}

export interface MarketplaceCatalogSnapshot {
    provider: MarketplaceProvider;
    merchantId: string;
    fetchedAt: string;
    items: MarketplaceCatalogItem[];
}

export interface MarketplaceSyncCounters {
    created: number;
    updated: number;
    skipped: number;
    imagesDownloaded: number;
    errors: number;
}

export interface MarketplaceSyncResult {
    ok: boolean;
    provider: MarketplaceProvider;
    counters: MarketplaceSyncCounters;
    finishedAt: string;
    errorMessage: string | null;
}

export interface MarketplaceCatalogPort {
    readonly provider: MarketplaceProvider;
    /**
     * Baixa o cardápio completo do merchant (não usado no caminho do chat).
     * Chamado só pelo job/botão Sincronizar.
     */
    fetchCatalog(params: {
        companyId: string;
        merchantId: string;
        accessToken: string;
    }): Promise<MarketplaceCatalogSnapshot>;
}
