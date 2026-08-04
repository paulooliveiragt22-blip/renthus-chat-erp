import type {
    MarketplaceCatalogItem,
    MarketplaceCatalogPort,
    MarketplaceCatalogSnapshot,
} from "@/src/types/contracts.marketplace";

const IFOOD_AUTH = "https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token";
const IFOOD_CATALOG = "https://merchant-api.ifood.com.br/catalog/v2.0";

/** Catálogo mock para homologar sync no Renthus sem credenciais iFood. */
export function buildMockIfoodCatalog(merchantId: string): MarketplaceCatalogSnapshot {
    const fetchedAt = new Date().toISOString();
    const items: MarketplaceCatalogItem[] = [
        {
            provider: "ifood",
            externalItemId: "mock-item-heineken-ln",
            externalProductId: "mock-prod-heineken",
            externalCategoryId: "mock-cat-cervejas",
            categoryName: "Cervejas",
            name: "Heineken Long Neck",
            description: "Garrafa 330ml (import mock iFood)",
            price: 10.9,
            currency: "BRL",
            imageUrl: null,
            available: true,
            externalCode: "HEI-LN",
        },
        {
            provider: "ifood",
            externalItemId: "mock-item-heineken-cx",
            externalProductId: "mock-prod-heineken-cx",
            externalCategoryId: "mock-cat-cervejas",
            categoryName: "Cervejas",
            name: "Heineken Caixa 6un",
            description: "Fardo 6 long necks (import mock iFood)",
            price: 59.9,
            currency: "BRL",
            imageUrl: null,
            available: true,
            externalCode: "HEI-CX6",
        },
        {
            provider: "ifood",
            externalItemId: "mock-item-agua",
            externalProductId: "mock-prod-agua",
            externalCategoryId: "mock-cat-bebidas",
            categoryName: "Bebidas",
            name: "Água mineral 500ml",
            description: null,
            price: 3.5,
            currency: "BRL",
            imageUrl: null,
            available: true,
            externalCode: "AGUA-500",
        },
    ];
    return {
        provider: "ifood",
        merchantId: merchantId || "mock-merchant",
        fetchedAt,
        items,
    };
}

export async function fetchIfoodAccessToken(params: {
    clientId: string;
    clientSecret: string;
    refreshToken?: string | null;
}): Promise<{ accessToken: string; refreshToken?: string } | null> {
    const body = new URLSearchParams();
    if (params.refreshToken) {
        body.set("grantType", "refresh_token");
        body.set("clientId", params.clientId);
        body.set("clientSecret", params.clientSecret);
        body.set("refreshToken", params.refreshToken);
    } else {
        body.set("grantType", "client_credentials");
        body.set("clientId", params.clientId);
        body.set("clientSecret", params.clientSecret);
    }
    try {
        const res = await fetch(IFOOD_AUTH, {
            method: "POST",
            headers: {
                accept: "application/json",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
            cache: "no-store",
            signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) return null;
        const json = (await res.json()) as {
            accessToken?: string;
            access_token?: string;
            refreshToken?: string;
            refresh_token?: string;
        };
        const accessToken = json.accessToken ?? json.access_token;
        if (!accessToken) return null;
        return {
            accessToken,
            refreshToken: json.refreshToken ?? json.refresh_token,
        };
    } catch {
        return null;
    }
}

/**
 * Lê cardápio via Catalog API (categories?includeItems=true).
 * Fallback: mock se falhar / sem token.
 */
export async function fetchIfoodCatalogLive(params: {
    merchantId: string;
    accessToken: string;
}): Promise<MarketplaceCatalogSnapshot | null> {
    const { merchantId, accessToken } = params;
    try {
        const catalogsRes = await fetch(
            `${IFOOD_CATALOG}/merchants/${encodeURIComponent(merchantId)}/catalogs`,
            {
                headers: { Authorization: `Bearer ${accessToken}`, accept: "application/json" },
                cache: "no-store",
                signal: AbortSignal.timeout(20_000),
            }
        );
        if (!catalogsRes.ok) return null;
        const catalogsJson = (await catalogsRes.json()) as
            | Array<{ id?: string }>
            | { catalogs?: Array<{ id?: string }> };
        const catalogs = Array.isArray(catalogsJson)
            ? catalogsJson
            : (catalogsJson.catalogs ?? []);
        const catalogId = catalogs[0]?.id;
        if (!catalogId) return null;

        const catsRes = await fetch(
            `${IFOOD_CATALOG}/merchants/${encodeURIComponent(merchantId)}/catalogs/${encodeURIComponent(catalogId)}/categories?includeItems=true`,
            {
                headers: { Authorization: `Bearer ${accessToken}`, accept: "application/json" },
                cache: "no-store",
                signal: AbortSignal.timeout(30_000),
            }
        );
        if (!catsRes.ok) return null;
        const catsJson = (await catsRes.json()) as unknown;
        const categories = Array.isArray(catsJson)
            ? catsJson
            : ((catsJson as { categories?: unknown[] }).categories ?? []);

        const items: MarketplaceCatalogItem[] = [];
        for (const cat of categories as Array<Record<string, unknown>>) {
            const categoryName = String(cat.name ?? cat.title ?? "Geral");
            const categoryId = cat.id != null ? String(cat.id) : null;
            const catItems = (cat.items ?? cat.itens ?? []) as Array<Record<string, unknown>>;
            for (const it of catItems) {
                const priceObj = it.price as { value?: number } | number | undefined;
                const price =
                    typeof priceObj === "number"
                        ? priceObj
                        : Number((priceObj as { value?: number } | undefined)?.value ?? it.unitPrice ?? 0);
                const products = (it.products as Array<Record<string, unknown>> | undefined) ?? [];
                const productName =
                    String(products[0]?.name ?? it.name ?? it.externalCode ?? "Item iFood").trim() ||
                    "Item iFood";
                const imageUrl =
                    (products[0]?.imagePath as string | undefined) ??
                    (it.imagePath as string | undefined) ??
                    (it.imageUrl as string | undefined) ??
                    null;
                items.push({
                    provider: "ifood",
                    externalItemId: String(it.id ?? it.externalCode ?? `${categoryId}-${productName}`),
                    externalProductId: products[0]?.id != null ? String(products[0].id) : null,
                    externalCategoryId: categoryId,
                    categoryName,
                    name: productName,
                    description:
                        (products[0]?.description as string | null | undefined) ??
                        (it.description as string | null | undefined) ??
                        null,
                    price: Number.isFinite(price) ? price : 0,
                    currency: "BRL",
                    imageUrl,
                    available: String(it.status ?? "AVAILABLE").toUpperCase() !== "UNAVAILABLE",
                    externalCode: (it.externalCode as string | null | undefined) ?? null,
                });
            }
        }

        return {
            provider: "ifood",
            merchantId,
            fetchedAt: new Date().toISOString(),
            items: items.filter((i) => i.price > 0 && i.name),
        };
    } catch (err) {
        console.warn("[ifood] fetchCatalogLive:", err instanceof Error ? err.message : err);
        return null;
    }
}

export class IfoodCatalogAdapter implements MarketplaceCatalogPort {
    readonly provider = "ifood" as const;

    async fetchCatalog(params: {
        companyId: string;
        merchantId: string;
        accessToken: string;
        useMock?: boolean;
    }): Promise<MarketplaceCatalogSnapshot> {
        if (params.useMock || !params.accessToken || params.accessToken === "mock") {
            return buildMockIfoodCatalog(params.merchantId);
        }
        const live = await fetchIfoodCatalogLive({
            merchantId: params.merchantId,
            accessToken: params.accessToken,
        });
        if (live && live.items.length > 0) return live;
        // Sem catálogo live → mock explícito para não falhar o botão em homologação
        console.warn("[ifood] live catalog empty/failed — using mock snapshot");
        return buildMockIfoodCatalog(params.merchantId);
    }
}

export const ifoodCatalogAdapter = new IfoodCatalogAdapter();
