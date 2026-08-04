import type {
    MarketplaceCatalogItem,
    MarketplaceCatalogPort,
    MarketplaceCatalogSnapshot,
} from "@/src/types/contracts.marketplace";

/** Mock Aiqfome — mesma porta de catálogo do iFood (sync manual). */
export function buildMockAiqfomeCatalog(merchantId: string): MarketplaceCatalogSnapshot {
    const items: MarketplaceCatalogItem[] = [
        {
            provider: "aiqfome",
            externalItemId: "aiq-mock-combo-burger",
            externalProductId: "aiq-prod-burger",
            externalCategoryId: "aiq-cat-lanches",
            categoryName: "Lanches",
            name: "X-Burger Aiqfome",
            description: "Import mock Aiqfome",
            price: 22.9,
            currency: "BRL",
            imageUrl: null,
            available: true,
            externalCode: "AIQ-XB",
        },
        {
            provider: "aiqfome",
            externalItemId: "aiq-mock-refri",
            externalProductId: "aiq-prod-refri",
            externalCategoryId: "aiq-cat-bebidas",
            categoryName: "Bebidas",
            name: "Refrigerante Lata",
            description: null,
            price: 6.5,
            currency: "BRL",
            imageUrl: null,
            available: true,
            externalCode: "AIQ-REF",
        },
    ];
    return {
        provider: "aiqfome",
        merchantId: merchantId || "aiq-mock-merchant",
        fetchedAt: new Date().toISOString(),
        items,
    };
}

export class AiqfomeCatalogAdapter implements MarketplaceCatalogPort {
    readonly provider = "aiqfome" as const;

    async fetchCatalog(params: {
        companyId: string;
        merchantId: string;
        accessToken: string;
        useMock?: boolean;
    }): Promise<MarketplaceCatalogSnapshot> {
        // API Aiqfome real entra quando houver credenciais — por ora sempre mock seguro.
        void params.accessToken;
        void params.companyId;
        return buildMockAiqfomeCatalog(params.merchantId);
    }
}

export const aiqfomeCatalogAdapter = new AiqfomeCatalogAdapter();
