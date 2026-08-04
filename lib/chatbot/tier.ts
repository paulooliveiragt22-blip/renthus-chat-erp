import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveSubscription } from "@/lib/billing/entitlements";
import { canUseAi, isAiEnabledInBotConfig } from "@/lib/billing/aiWallet";
import { normalizePlanKey } from "@/lib/billing/planCatalog";

/** Motor de chatbot (não confundir com plans.key comercial). */
export type ChatbotProductTier = "starter" | "pro";

/**
 * Essencial / Pro / Market usam motor PRO quando IA ligada e há crédito.
 * Sem crédito ou toggle off → Flow/Starter (WhatsApp continua).
 */
export async function getChatbotProductTier(
    admin: SupabaseClient,
    companyId: string,
    botConfig?: Record<string, unknown> | null
): Promise<ChatbotProductTier> {
    try {
        const sub = await getActiveSubscription(admin, companyId);
        const planKey = normalizePlanKey(sub?.plan_key ?? null);
        if (!planKey) return "starter";

        if (!isAiEnabledInBotConfig(botConfig ?? null)) return "starter";

        const ok = await canUseAi(admin, companyId);
        if (!ok) return "starter";

        // Todos os planos comerciais atuais têm direito à IA (com crédito).
        return "pro";
    } catch (e) {
        console.warn("[chatbot/tier] falha ao resolver plano, fallback starter:", e);
        return "starter";
    }
}
