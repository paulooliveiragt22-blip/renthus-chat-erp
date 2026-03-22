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

export interface Session {
    id: string;
    step: string;
    cart: CartItem[];
    customer_id: string | null;
    context: Record<string, unknown>;
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

export interface AddressMatch {
    street:      string;   // "Rua das Flores"
    houseNumber: string;   // "86"
    neighborhood: string | null; // "São Mateus" (se detectado)
    full: string;          // formatted: "Rua das Flores, 86 - São Mateus"
    rawSlice: string;      // trecho original que foi reconhecido como endereço
}
