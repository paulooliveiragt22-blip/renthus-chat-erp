import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runOrderHintsForAi } from "@/src/pro/adapters/ai/tools/orderHintsForAi";

/**
 * Wrapper Vercel AI SDK de `get_order_hints` (Fase 3 — adiado da Fase 2, ver
 * docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md). Sem estado de turno: só repassa/consulta.
 */
export function createGetOrderHintsTool(deps: {
    admin: SupabaseClient;
    companyId: string;
    phoneE164: string;
    profileName: string | null;
    prefetchedOrderHints?: unknown;
}) {
    return tool({
        description: "Retorna endereços salvos e favoritos do cliente.",
        inputSchema: z.object({}),
        execute: async () =>
            runOrderHintsForAi({
                admin: deps.admin,
                companyId: deps.companyId,
                phoneE164: deps.phoneE164,
                profileName: deps.profileName,
                prefetchedOrderHints: deps.prefetchedOrderHints,
            }),
    });
}
