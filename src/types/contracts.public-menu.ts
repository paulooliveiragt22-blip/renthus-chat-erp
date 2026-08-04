/**
 * Contratos do cardápio web público (F0).
 * camelCase canônico — adapters/parsers convertem do RPC (snake_case/jsonb).
 */

export type MenuSlug = string & { readonly __brand: "MenuSlug" };

export type PublicMenuEventType = "page_view" | "product_view" | "category_view";

export interface PublicMenuStore {
    companyId: string;
    slug: MenuSlug;
    displayName: string;
    tagline: string | null;
    logoUrl: string | null;
    whatsappPhone: string | null;
    city: string | null;
    state: string | null;
    isActive: boolean;
}

export interface PublicMenuItem {
    /** produto_embalagens.id — unidade de venda no cardápio */
    embalagemId: string;
    productId: string;
    categoryId: string | null;
    categoryName: string | null;
    name: string;
    description: string | null;
    /** preco_venda da embalagem */
    price: number;
    currency: "BRL";
    sigla: string;
    thumbnailUrl: string | null;
    imageUrl: string | null;
    inStock: boolean;
}

export interface PublicMenuCategory {
    id: string;
    name: string;
    sortOrder: number;
    items: PublicMenuItem[];
}

export interface PublicMenuResponse {
    store: PublicMenuStore;
    categories: PublicMenuCategory[];
    itemCount: number;
    generatedAt: string;
}

export interface PublicMenuNotFound {
    ok: false;
    error: "menu_not_found" | "menu_inactive";
}

export interface PublicMenuOk {
    ok: true;
    menu: PublicMenuResponse;
}

export type PublicMenuResult = PublicMenuOk | PublicMenuNotFound;

export interface PublicMenuEventInput {
    visitorId: string;
    eventType: PublicMenuEventType;
    productId?: string | null;
    categoryId?: string | null;
    embalagemId?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    referrer?: string | null;
}

export interface MenuProfileAdmin {
    companyId: string;
    slug: MenuSlug;
    displayName: string;
    tagline: string | null;
    logoUrl: string | null;
    whatsappPhone: string | null;
    isActive: boolean;
    updatedAt: string;
}

export interface MenuProfileUpsertInput {
    slug: string;
    displayName: string;
    tagline?: string | null;
    logoUrl?: string | null;
    whatsappPhone?: string | null;
    isActive?: boolean;
}

/** Linha bruta retornada pelo RPC (jsonb interno / PostgREST). */
export interface PublicMenuRpcStoreRow {
    company_id: string;
    slug: string;
    display_name: string;
    tagline: string | null;
    logo_url: string | null;
    whatsapp_phone: string | null;
    city: string | null;
    state: string | null;
    is_active: boolean;
}

export interface PublicMenuRpcItemRow {
    embalagem_id: string;
    product_id: string;
    category_id: string | null;
    category_name: string | null;
    name: string;
    description: string | null;
    price: number | string;
    sigla: string | null;
    thumbnail_url: string | null;
    image_url: string | null;
    in_stock: boolean;
    category_sort: number | null;
}

export interface PublicMenuRpcPayload {
    store: PublicMenuRpcStoreRow;
    items: PublicMenuRpcItemRow[];
}
