/**
 * @deprecated Use `resolveAiCapabilityProfile` (`aiCapabilityProfile.ts`).
 * Mantido só como alias de compatibilidade — o motor Starter foi removido.
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveAiCapabilityProfile } from "@/lib/chatbot/aiCapabilityProfile";

/** @deprecated Sempre "pro" se houver crédito; caso contrário o pipeline usa perfil degradado. */
export type ChatbotProductTier = "pro";

/**
 * @deprecated Prefer `resolveAiCapabilityProfile`.
 * Retorna "pro" quando há plano+crédito; ainda "pro" no degradado (motor único).
 */
export async function getChatbotProductTier(
    admin: SupabaseClient,
    companyId: string,
    botConfig?: Record<string, unknown> | null
): Promise<ChatbotProductTier> {
    await resolveAiCapabilityProfile(admin, companyId, botConfig);
    return "pro";
}
