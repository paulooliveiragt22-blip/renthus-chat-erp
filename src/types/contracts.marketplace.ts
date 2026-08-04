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
    /** Quando true, sync usa catálogo mock (homologação sem API iFood). */
    useMock?: boolean;
    /** Cron F4.1 — re-sync periódico se conexão ativa. */
    autoSyncEnabled?: boolean;
    /** Intervalo 1–6 horas entre syncs automáticos. */
    syncIntervalHours?: number;
}

/** Grupo de opcionais/complementos (iFood optionGroups). */
export interface MarketplaceCatalogOptionGroup {
    externalGroupId: string;
    name: string;
    min: number;
    max: number;
    optionExternalIds: string[];
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
    /** true = complemento/opcional (não lista sozinho no cardápio web). */
    isComplement?: boolean;
    /** Item pai (combo) quando isComplement. */
    parentExternalItemId?: string | null;
    /** Grupos de opção no item pai (F4.4). */
    optionGroups?: MarketplaceCatalogOptionGroup[];
    /** Default true; complementos usam false. */
    showOnMenu?: boolean;
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
        useMock?: boolean;
    }): Promise<MarketplaceCatalogSnapshot>;
}
