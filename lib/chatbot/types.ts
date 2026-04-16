/**
 * lib/chatbot/types.ts
 *
 * Interfaces e tipos compartilhados entre todos os módulos do chatbot.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineDependencies } from "@/src/pro/pipeline/context";
import type { WaConfig } from "../whatsapp/send";

/** Subconjunto das portas do PRO V2 para testes ou homologação (omitir em produção). */
export type ProPipelineDependencyOverrides = Partial<PipelineDependencies>;

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
    /** Injeta portas do pipeline PRO V2 (ex.: testes); ver `makeProPipelineDependencies`. */
    proPipelineDependencyOverrides?: ProPipelineDependencyOverrides;
}

export interface CartItem {
    variantId: string;
    productId: string;
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

export interface Category {
    id:   string;
    name: string;
}

export interface Customer {
    id:      string;
    name:    string | null;
    phone:   string | null;
    address: string | null;
}

export interface DeliveryZone { id: string; label: string; fee: number; }

export interface CompanyConfig {
    name:      string;
    settings:  Record<string, unknown>;
    botConfig: Record<string, unknown>;
}
