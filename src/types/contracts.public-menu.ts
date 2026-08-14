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
    /** Foto de perfil (avatar circular). */
    logoUrl: string | null;
    /** Capa do restaurante (estilo Facebook). */
    coverUrl: string | null;
    whatsappPhone: string | null;
    city: string | null;
    state: string | null;
    isActive: boolean;
    /** Loja aceita entrega (canônico: `company_delivery_policy.deliveries_enabled`). */
    deliveriesEnabled: boolean;
    /** Loja aceita retirada no local. */
    pickupEnabled: boolean;
    /** Horário de abertura HH:MM (fuso da loja). */
    openTime: string | null;
    closeTime: string | null;
    timeZone: string;
    /** Texto curto de delivery (ex.: área / raio). */
    deliveryDescription: string | null;
    /** Calculado no servidor no momento do load. */
    isOpen: boolean;
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
    /** Unidades por embalagem (ex.: CX c/8 → 8). */
    fatorConversao: number;
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
    coverUrl: string | null;
    whatsappPhone: string | null;
    isActive: boolean;
    /** Domínio próprio (host), ex. cardapio.loja.com.br */
    customDomain: string | null;
    customDomainVerified: boolean;
    updatedAt: string;
}

export interface MenuProfileUpsertInput {
    slug: string;
    displayName: string;
    tagline?: string | null;
    logoUrl?: string | null;
    coverUrl?: string | null;
    whatsappPhone?: string | null;
    isActive?: boolean;
    customDomain?: string | null;
    customDomainVerified?: boolean;
}

/** Painel F4.2 — agregados do cardápio web. */
export interface MenuAnalyticsDay {
    date: string;
    pageViews: number;
    uniqueVisitors: number;
}

export interface MenuAnalyticsTopProduct {
    productId: string;
    name: string;
    views: number;
}

export interface MenuAnalyticsUtmSource {
    utmSource: string;
    pageViews: number;
    uniqueVisitors: number;
}

export interface MenuAnalyticsResponse {
    from: string;
    to: string;
    pageViews: number;
    uniqueVisitors: number;
    productViews: number;
    days: MenuAnalyticsDay[];
    topProducts: MenuAnalyticsTopProduct[];
    utmSources: MenuAnalyticsUtmSource[];
}

/** Carrinho no browser (embalagem = unidade de venda). */
export interface PublicMenuCartLine {
    embalagemId: string;
    productId: string;
    name: string;
    sigla: string;
    fatorConversao?: number;
    unitPrice: number;
    qty: number;
}

export interface PublicMenuSavedAddress {
    id: string;
    title: string;
    description: string;
    logradouro: string;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string;
    estado: string;
    cep: string | null;
    isPrincipal: boolean;
}

export interface PublicMenuNewAddressInput {
    apelido?: string | null;
    logradouro: string;
    numero: string;
    complemento?: string | null;
    bairro: string;
    cidade: string;
    estado: string;
    cep?: string | null;
}

export interface PublicMenuSessionOk {
    ok: true;
    sessionToken: string;
    /** True no 1º checkout IG/Messenger até vincular telefone. */
    needsPhone?: boolean;
    customer: {
        id: string;
        name: string | null;
        phoneE164: string;
        isNew: boolean;
        needsPhone?: boolean;
    };
    addresses: PublicMenuSavedAddress[];
}

export type PublicMenuSessionError =
    | { ok: false; error: "menu_not_found" | "menu_inactive" | "phone_invalid" | "token_invalid" | "customer_failed" | "rate_limit_exceeded" | "name_required" };

export type PublicMenuSessionResult = PublicMenuSessionOk | PublicMenuSessionError;

export interface PublicMenuCheckoutInput {
    items: Array<{ embalagemId: string; qty: number }>;
    paymentMethod: "pix" | "cash" | "card";
    changeFor?: number | string | null;
    fulfillmentType?: "delivery" | "pickup" | null;
    savedAddressId?: string | null;
    newAddress?: PublicMenuNewAddressInput | null;
}

export type PublicMenuCheckoutResult =
    | {
          ok: true;
          orderId: string;
          orderCode: string;
          requireApproval: boolean;
          subtotal: number;
          deliveryFee: number;
          grandTotal: number;
          deliveryAddress: string;
          etaMin: number | null;
      }
    | {
          ok: false;
          error: string;
          message?: string;
          minOrder?: number;
          grandTotal?: number;
      };

export interface PublicMenuDeliveryQuoteOk {
    ok: true;
    served: boolean;
    fee: number;
    minOrder: number | null;
    etaMin: number | null;
    label: string;
    reason: string | null;
    cepLookup?: {
        logradouro: string;
        bairro: string;
        cidade: string;
        estado: string;
        cep: string;
    } | null;
}

export type PublicMenuDeliveryQuoteResult =
    | PublicMenuDeliveryQuoteOk
    | { ok: false; error: string };

export interface PublicMenuOrderItem {
    productName: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
}

export interface PublicMenuOrderSummary {
    id: string;
    orderCode: string;
    createdAt: string;
    status: string;
    confirmationStatus: string | null;
    statusLabel: string;
    grandTotal: number;
    itemCount: number;
    paymentMethod: string | null;
}

export interface PublicMenuOrderDetail extends PublicMenuOrderSummary {
    subtotal: number;
    deliveryFee: number;
    deliveryAddress: string | null;
    changeFor: number | null;
    paymentLabel: string;
    items: PublicMenuOrderItem[];
    source: string | null;
    channel: string | null;
}

export type PublicMenuOrdersListResult =
    | { ok: true; orders: PublicMenuOrderSummary[] }
    | { ok: false; error: string };

export type PublicMenuOrderDetailResult =
    | { ok: true; order: PublicMenuOrderDetail }
    | { ok: false; error: string };

/** Linha bruta retornada pelo RPC (jsonb interno / PostgREST). */
export interface PublicMenuRpcStoreRow {
    company_id: string;
    slug: string;
    display_name: string;
    tagline: string | null;
    logo_url: string | null;
    cover_url?: string | null;
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
    fator_conversao?: number | string | null;
    thumbnail_url: string | null;
    image_url: string | null;
    in_stock: boolean;
    category_sort: number | null;
}

export interface PublicMenuRpcPayload {
    store: PublicMenuRpcStoreRow;
    items: PublicMenuRpcItemRow[];
}
