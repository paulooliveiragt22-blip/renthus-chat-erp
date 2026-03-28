import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaConfig } from "../whatsapp/send";

export interface ProcessMessageParams {
    admin:          SupabaseClient;
    companyId:      string;
    threadId:       string;
    messageId:      string;
    phoneE164:      string;
    text:           string;
    profileName?:   string | null;
    /** Credenciais do canal WhatsApp da empresa (token + phoneNumberId) */
    waConfig?:      WaConfig;
    /** Flow ID do catálogo configurado para esta empresa */
    catalogFlowId?: string;
}

export interface CartItem {
    variantId: string;
    productId?: string;
    name:      string;
    price:     number;
    qty:       number;
    isCase?:   boolean;
    caseQty?:  number;
}

export interface HistoryEntry {
    role: "user" | "bot";
    text: string;
    ts:   number;
}

export interface Session {
    id:          string;
    step:        string;
    cart:        CartItem[];
    customer_id: string | null;
    context:     Record<string, unknown>;
    history:     HistoryEntry[];
}
