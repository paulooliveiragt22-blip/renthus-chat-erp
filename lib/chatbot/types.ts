/**
 * lib/chatbot/types.ts
 *
 * Interfaces e tipos compartilhados entre todos os módulos do chatbot.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface ProcessMessageParams {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    messageId: string;
    phoneE164: string;
    text: string;
    profileName?: string | null;
}

export interface CartItem {
    variantId: string;
    productId: string;
    name: string;     // ex: "Heineken 600ml" ou "Heineken 600ml (cx 12un)"
    price: number;
    qty: number;
    isCase?: boolean; // true = compra por caixa
    caseQty?: number; // unidades por caixa (para cálculo de unid. totais)
}

export interface HistoryEntry {
    role: "user" | "bot";
    text: string;
    ts: number;
}

export interface Session {
    id: string;
    step: string;
    cart: CartItem[];
    customer_id: string | null;
    context: Record<string, unknown>;
    history: HistoryEntry[];
}

export interface Category {
    id: string;
    name: string;
}

export interface Brand {
    id: string;
    name: string;
}

/** Variante de produto para exibição no catálogo (após seleção de marca). */
export interface VariantRow {
    id:              string;
    productId:       string;
    productName:     string;
    details:         string | null;
    /** produto_embalagens.descricao — somente para busca, nunca exibir ao cliente */
    searchDesc?:     string | null;
    tags:            string | null;  // sinônimos separados por vírgula
    volumeValue:     number;
    unit:            string;
    /** Sigla da unidade de medida do volume (ex: "ml", "L", "kg"). Vem do JOIN com unit_types. */
    unitTypeSigla:   string | null;
    unitPrice:       number;
    hasCase:         boolean;
    caseQty:         number | null;
    casePrice:       number | null;
    /** Sigla comercial da embalagem bulk: "CX" | "FARD" | "PAC" (null quando só tem UN) */
    bulkSigla:       string | null;
    // ID da embalagem bulk (CX/FARD/PAC) para debitar estoque quando `isCase === true`.
    caseVariantId?:  string;
    isAccompaniment: boolean;
}

export interface Customer {
    id: string;
    name: string | null;
    phone: string | null;
    address: string | null;
}

/**
 * Um item na lista de produtos (etapa 1 da seleção).
 * Um entry por produto+variante; unitário vs caixa é escolhido na etapa seguinte.
 */
export interface ProductListItem {
    idx:         number;
    productId:   string;
    variantId:   string;
    displayName: string;  // marca + volume sem prefixo da categoria, ex: "Original 300ml"
    unitPrice:   number;
    hasCase:     boolean;
    caseQty?:    number;
    casePrice?:  number;
}

export interface DeliveryZone { id: string; label: string; fee: number; }

export interface CompanyConfig {
    name:      string;
    settings:  Record<string, unknown>;
    botConfig: Record<string, unknown>;
}

/** Tipo estrito de retorno do parser (OrderParserService + ClaudeParser).
 *  Nunca null — em caso de erro retorna ok=false, intent=low_confidence. */
export interface ParseResult {
    ok:            boolean;
    intent:        "add_to_cart" | "product_question" | "chitchat" | "order_status" | "confirm_order" | "cancel" | "human" | "low_confidence";
    items:         import("./OrderParserService").ParsedItem[];
    address:       string | null;
    paymentMethod: "pix" | "card" | "cash" | null;
    confidence:    number;  // 0.0 – 1.0
    question:      string | null; // para product_question
    error:         string | null;
}

export interface AddressMatch {
    street:      string;   // "Rua das Flores"
    houseNumber: string;   // "86"
    neighborhood: string | null; // "São Mateus" (se detectado)
    full: string;          // formatted: "Rua das Flores, 86 - São Mateus"
    rawSlice: string;      // trecho original que foi reconhecido como endereço
}
