import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPort } from "@/src/pro/ports/catalog.port";
import { runSearchProdutosForAi } from "@/src/pro/adapters/ai/tools/searchProdutosForAi";
import { upsertPendingPickGroup } from "@/src/pro/pipeline/pendingPickGroups";
import { advanceWorklistAfterSearch } from "@/src/pro/pipeline/orderWorklist/advanceWorklistAfterSearch";
import { matchWorklistLineForSearch } from "@/src/pro/domain/orderWorklist/matchWorklistLine";
import { pendingSearchTermsFromWorklist } from "@/src/pro/domain/orderWorklist/orderWorklist";
import { unionAllowlistIds } from "@/src/pro/pipeline/mergeOrderDraft";
import type { TurnState } from "./turnState";

/**
 * Wrapper Vercel AI SDK de `search_produtos` (Fase 3 — adiado da Fase 2, ver
 * docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md). Orquestração real em `runSearchProdutosForAi`;
 * aqui só o contrato de tool + escrita no `TurnState` do turno.
 *
 * ADR 0011: avança `orderWorklist`; `outros_produtos_pendentes` é opcional/ignorado no write path.
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
            "Busca catálogo real da empresa. Em `query` mantenha o termo do cliente completo (ex.: 'Heineken long neck caixa'), não só a marca. A resposta inclui guidance_for_model_pt. Prefira buscar o próximo item pending_search da worklist.",
        inputSchema: z.object({
            query: z.string().describe("Termo de busca completo, como o cliente escreveu."),
            category_hint: z
                .string()
                .nullish()
                .describe("Categoria sugerida, se o cliente citou; null se não citou."),
            worklist_line_id: z
                .string()
                .nullish()
                .describe("Opcional: id da line pending_search na worklist do servidor."),
            outros_produtos_pendentes: z
                .array(z.string())
                .nullish()
                .describe(
                    "Sinal opcional (não apaga a worklist): outros produtos citados ainda não buscados. " +
                        "O servidor já mantém a fila; preferir omitir ou listar o que ainda falta."
                ),
        }),
        execute: async ({ query, category_hint, worklist_line_id }) => {
            const matched = matchWorklistLineForSearch({
                worklist: deps.turnState.orderWorklist,
                query,
                lineId: worklist_line_id,
            });
            const result = await runSearchProdutosForAi(
                { query, categoryHint: category_hint ?? null },
                {
                    admin: deps.admin,
                    catalog: deps.catalog,
                    companyId: deps.companyId,
                    customerId: deps.customerId,
                    userText: deps.userText,
                    worklistLineId: matched?.id ?? worklist_line_id ?? null,
                }
            );

            deps.turnState.allowlistIds = unionAllowlistIds(
                deps.turnState.allowlistIds,
                result.allowlistIds
            );
            deps.turnState.emptySearchStreak = result.wasEmpty
                ? deps.turnState.emptySearchStreak + 1
                : 0;
            if (result.wasEmpty) {
                deps.turnState.matchingMetrics.searchHitsZero += 1;
            }
            deps.turnState.searchInvokedThisTurn = true;
            deps.turnState.searchCallCount += 1;
            deps.turnState.searchedProductQueriesThisTurn = [
                ...deps.turnState.searchedProductQueriesThisTurn,
                query,
            ];

            const hitCount = result.wasEmpty ? 0 : result.allowlistIds.length;
            const productKey = result.pendingPickGroup?.productKey ?? null;
            const uniqueId =
                hitCount === 1 ? result.allowlistIds[0] ?? null : null;

            deps.turnState.orderWorklist = advanceWorklistAfterSearch({
                worklist: deps.turnState.orderWorklist,
                query,
                hitCount: result.pendingPickGroup
                    ? Math.max(hitCount, 2)
                    : hitCount,
                productKey,
                produtoEmbalagemId: uniqueId,
                lineId: matched?.id ?? null,
            });

            if (result.pendingPickGroup) {
                const lineId =
                    matched?.id ??
                    result.pendingPickGroup.lineId ??
                    deps.turnState.orderWorklist.lines.find(
                        (l) => l.status === "ambiguous" && l.productKey === productKey
                    )?.id ??
                    result.pendingPickGroup.lineId;
                deps.turnState.pendingPickGroups = upsertPendingPickGroup(
                    deps.turnState.pendingPickGroups,
                    { ...result.pendingPickGroup, lineId }
                );
                /** Ambíguo → só via worklist/groups; lastSearchPicks não compete. */
                deps.turnState.lastSearchPicks = [];
            } else if (deps.turnState.pendingPickGroups.length > 0) {
                deps.turnState.lastSearchPicks = [];
            } else {
                deps.turnState.lastSearchPicks = result.lastSearchPicks;
            }
            return {
                ...result.body,
                worklist_pending_search: pendingSearchTermsFromWorklist(
                    deps.turnState.orderWorklist
                ),
            };
        },
    });
}
