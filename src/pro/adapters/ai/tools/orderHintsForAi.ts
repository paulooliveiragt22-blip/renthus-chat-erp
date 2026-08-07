import type { SupabaseClient } from "@supabase/supabase-js";
import { buildOrderHintsPayload } from "@/src/pro/tools/orderHints";

/**
 * Orquestração de `get_order_hints` extraída de `ai.service.full.ts` (mesma lógica, agora
 * reusável pelo loop Vercel AI SDK — ver docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md Fase 3).
 * Se `prefetchedOrderHints` já veio carregado pelo servidor neste turno, reaproveita e só
 * adiciona a guidance textual; caso contrário, consulta o banco.
 */

export type OrderHintsForAiDeps = {
    admin: SupabaseClient;
    companyId: string;
    phoneE164: string;
    profileName: string | null;
    prefetchedOrderHints?: unknown;
};

export async function runOrderHintsForAi(deps: OrderHintsForAiDeps): Promise<Record<string, unknown>> {
    const cached = deps.prefetchedOrderHints;
    if (cached && typeof cached === "object") {
        return {
            ...cached,
            guidance_for_model_pt: [
                "Hints já carregados no servidor neste turno — use saved_addresses/favoritos sem nova busca.",
            ],
        };
    }
    return buildOrderHintsPayload({
        admin: deps.admin,
        companyId: deps.companyId,
        phoneE164: deps.phoneE164,
        name: deps.profileName ?? null,
    });
}
