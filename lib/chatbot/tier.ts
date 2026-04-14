import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getActiveSubscription } from "@/lib/billing/entitlements";

/** Plano comercial → motor de chatbot. */
export type ChatbotProductTier = "starter" | "pro";

/**
 * Starter = plano `starter` (ou sem subscrição ativa).
 * PRO (chatbot inteligente) = plano `pro` em `subscriptions` + `plans.key`.
 */
export async function getChatbotProductTier(
    admin: SupabaseClient,
    companyId: string
): Promise<ChatbotProductTier> {
    try {
        const sub = await getActiveSubscription(admin, companyId);
        if (sub?.plan_key === "pro") return "pro";
    } catch (e) {
        console.warn("[chatbot/tier] falha ao resolver plano, fallback starter:", e);
    }
    return "starter";
}
