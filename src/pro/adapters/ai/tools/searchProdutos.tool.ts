import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPort } from "@/src/pro/ports/catalog.port";
import { runSearchProdutosForAi } from "@/src/pro/adapters/ai/tools/searchProdutosForAi";
import { upsertPendingPickGroup } from "@/src/pro/pipeline/pendingPickGroups";
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
            // AI SDK + Groq/OpenAI strict tools: use .nullable(), not .optional()
            // (modelo manda null → "expected string, got null"). Docs: prompt-engineering tip.
            category_hint: z
                .string()
                .nullable()
                .describe("Categoria sugerida, se o cliente citou; null se não citou."),
            outros_produtos_pendentes: z
                .array(z.string())
                .nullable()
                .describe(
                    "OBRIGATÓRIO a cada chamada: releia a mensagem do cliente e liste TODO OUTRO produto que ele citou " +
                        "e que você ainda NÃO buscou nesta busca nem em busca anterior deste atendimento (ex.: cliente disse " +
                        "'quero skol e original', você está buscando 'original' agora -> outros_produtos_pendentes=['skol']). " +
                        "Array vazio [] (ou null) quando não sobrar nenhum. NÃO omita este campo."
                ),
        }),
        execute: async ({ query, category_hint, outros_produtos_pendentes }) => {
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
            deps.turnState.emptySearchStreak = result.wasEmpty
                ? deps.turnState.emptySearchStreak + 1
                : 0;
            if (result.wasEmpty) {
                deps.turnState.matchingMetrics.searchHitsZero += 1;
            }
            deps.turnState.searchInvokedThisTurn = true;
            deps.turnState.searchCallCount += 1;
            deps.turnState.pendingTermsFromSearch = (
                Array.isArray(outros_produtos_pendentes) ? outros_produtos_pendentes : []
            )
                .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
                .map((v) => v.trim())
                .slice(0, 5);
            if (result.pendingPickGroup) {
                /**
                 * `pendingPickGroups` substitui totalmente `lastSearchPicks` para este achado —
                 * deixar os dois populados junto faz o card de botão legado (`clarify_product_picks`)
                 * disparar de novo mais tarde, quando o grupo já tiver sido resolvido (bug real do
                 * smoke S2: "Perfeito, já anotado" + botão pedindo a mesma escolha de novo).
                 */
                deps.turnState.pendingPickGroups = upsertPendingPickGroup(
                    deps.turnState.pendingPickGroups,
                    result.pendingPickGroup
                );
            } else {
                deps.turnState.lastSearchPicks = result.lastSearchPicks;
            }
            return result.body;
        },
    });
}
