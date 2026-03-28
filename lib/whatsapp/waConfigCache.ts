/**
 * lib/whatsapp/waConfigCache.ts
 *
 * Cache em memória de WaConfig por companyId (TTL 5 min).
 * Evita um DB round-trip em todo envio de mensagem.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaConfig } from "./send";

const cache = new Map<string, { config: WaConfig; expiresAt: number }>();
const TTL_MS = 5 * 60 * 1000;

/**
 * Retorna WaConfig para a empresa. Busca canal ativo no banco se não estiver em cache.
 * Retorna null se nenhum canal ativo for encontrado.
 */
export async function getWaConfig(
    admin: SupabaseClient,
    companyId: string
): Promise<WaConfig | null> {
    const cached = cache.get(companyId);
    if (cached && cached.expiresAt > Date.now()) return cached.config;

    const { data: channel } = await admin
        .from("whatsapp_channels")
        .select("from_identifier, provider_metadata")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

    if (!channel) return null;

    const pm = (channel.provider_metadata as { access_token?: string } | null) ?? {};
    const config: WaConfig = {
        phoneNumberId: channel.from_identifier as string,
        accessToken:   pm.access_token ?? process.env.WHATSAPP_TOKEN ?? "",
    };

    cache.set(companyId, { config, expiresAt: Date.now() + TTL_MS });
    return config;
}

/** Invalida o cache para forçar releitura no próximo envio (ex: token rotacionado). */
export function invalidateWaConfig(companyId: string): void {
    cache.delete(companyId);
}
