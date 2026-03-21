/**
 * lib/whatsapp/getConfig.ts
 *
 * Resolve configurações do WhatsApp por empresa.
 * Busca primeiro em company_integrations (provider = 'whatsapp'),
 * com fallback nas variáveis de ambiente globais.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface WhatsAppConfig {
    token:           string;
    phoneNumberId:   string;
    flowId:          string | null;
    flowsPrivateKey: string | null;
}

export async function getWhatsAppConfig(
    admin: SupabaseClient,
    companyId: string
): Promise<WhatsAppConfig> {
    const { data } = await admin
        .from("company_integrations")
        .select("config")
        .eq("company_id", companyId)
        .eq("provider", "whatsapp")
        .eq("is_active", true)
        .maybeSingle();

    const cfg = (data?.config ?? {}) as Record<string, string>;

    return {
        token:           cfg.token           ?? process.env.WHATSAPP_TOKEN           ?? "",
        phoneNumberId:   cfg.phone_number_id  ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
        flowId:          cfg.flow_id          ?? process.env.WHATSAPP_FLOW_ID         ?? null,
        flowsPrivateKey: cfg.flows_private_key ?? process.env.WHATSAPP_FLOWS_PRIVATE_KEY ?? null,
    };
}
