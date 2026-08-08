import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPort } from "@/src/pro/ports/catalog.port";
import { runSearchProdutosForAi } from "@/src/pro/adapters/ai/tools/searchProdutosForAi";
import type { TurnState } from "./turnState";

/**
 * Wrapper Vercel AI SDK de `search_produtos` (Fase 3 — adiado da Fase 2, ver
 * docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md). Orquestração real em `runSearchProdutosForAi`;
 * aqui só o contrato de tool + escrita no `TurnState` do turno.
 */
export function createSearchProdutosTool(deps: {
    admin: SupabaseClient;
    catalog: CatalogPort;
    companyId: string;
    customerId: string | null;
    userText: string;
    turnState: TurnState;
}) {
    return tool({
        description:
            "Busca catálogo real da empresa. Em `query` mantenha o termo do cliente completo (ex.: 'Heineken long neck caixa'), não só a marca. A resposta inclui guidance_for_model_pt.",
        inputSchema: z.object({
            query: z.string().describe("Termo de busca completo, como o cliente escreveu."),
            category_hint: z.string().optional().describe("Categoria sugerida, se o cliente citou."),
        }),
        execute: async ({ query, category_hint }) => {
            const result = await runSearchProdutosForAi(
                { query, categoryHint: category_hint ?? null },
                {
                    admin: deps.admin,
                    catalog: deps.catalog,
                    companyId: deps.companyId,
                    customerId: deps.customerId,
                    userText: deps.userText,
                }
            );
            deps.turnState.allowlistIds = result.allowlistIds;
            deps.turnState.lastSearchPicks = result.lastSearchPicks;
            deps.turnState.emptySearchStreak = result.wasEmpty
                ? deps.turnState.emptySearchStreak + 1
                : 0;
            deps.turnState.searchInvokedThisTurn = true;
            deps.turnState.searchCallCount += 1;
            return result.body;
        },
    });
}
