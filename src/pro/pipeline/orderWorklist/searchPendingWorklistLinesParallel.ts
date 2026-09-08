import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPort } from "@/src/pro/ports/catalog.port";
import type { ProSessionState } from "@/src/types/contracts";
import {
    fetchCatalogRowsForAi,
    finalizeSearchProdutosForAi,
} from "@/src/pro/adapters/ai/tools/searchProdutosForAi";
import {
    createEmptyOrderWorklist,
    expireExhaustedPendingSearchLines,
    listLinesByStatus,
    MAX_SEARCH_ATTEMPTS_PER_LINE,
} from "@/src/pro/domain/orderWorklist/orderWorklist";
import { applySearchResultToLine } from "@/src/pro/pipeline/orderWorklist/applySearchResultToLine";
import {
    createBatchSearchContext,
    enrichBatchSearchContextHabits,
    habitSiglaForProductIds,
} from "@/src/pro/pipeline/orderWorklist/batchSearchContext";
import {
    coalescePrepareUniqueHits,
    type UniquePrepareHit,
} from "@/src/pro/pipeline/orderWorklist/coalescePrepareUniqueHits";
import { syncPendingPickGroupsFromWorklist } from "@/src/pro/pipeline/orderWorklist/syncPendingPickGroupsFromWorklist";

/** Cap de buscas paralelas por turno (ADR 0011 D6/D7). */
export const MAX_PARALLEL_PENDING_SEARCHES = 5;

export type SearchPendingWorklistLinesResult = {
    state: ProSessionState;
    searchedLineIds: string[];
    preparedLineIds: string[];
    prepareCallCount: number;
    searchFailCount: number;
};

/**
 * Fan-out / fan-in (ADR 0011 D7):
 * 1) preload siglas
 * 2) N× catalog I/O paralelo
 * 3) 1× habits
 * 4) finalize sync + fold ordenado
 * 5) 1× coalesce prepare dos hits únicos
 */
export async function searchPendingWorklistLinesParallel(params: {
    admin: SupabaseClient;
    catalog: CatalogPort;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
    packagingContextText: string;
    maxLines?: number;
}): Promise<SearchPendingWorklistLinesResult> {
    const maxLines = Math.min(
        Math.max(1, params.maxLines ?? MAX_PARALLEL_PENDING_SEARCHES),
        MAX_PARALLEL_PENDING_SEARCHES
    );

    let worklist = expireExhaustedPendingSearchLines(
        params.state.orderWorklist ?? createEmptyOrderWorklist()
    );
    let pendingPickGroups = [...(params.state.pendingPickGroups ?? [])];
    let allowlistIds = [...(params.state.searchProdutoEmbalagemIds ?? [])];
    let draft = params.state.draft;

    const pending = listLinesByStatus(worklist, "pending_search")
        .filter((l) => (l.searchAttempts ?? 0) < MAX_SEARCH_ATTEMPTS_PER_LINE)
        .slice(0, maxLines);

    if (!pending.length) {
        return {
            state: {
                ...params.state,
                orderWorklist: worklist,
                pendingPickGroups: syncPendingPickGroupsFromWorklist({
                    worklist,
                    groups: pendingPickGroups,
                }),
            },
            searchedLineIds: [],
            preparedLineIds: [],
            prepareCallCount: 0,
            searchFailCount: 0,
        };
    }

    let ctx = await createBatchSearchContext({
        admin: params.admin,
        companyId: params.companyId,
        customerId: params.customerId,
    });

    type PhaseOk = {
        lineId: string;
        query: string;
        phase: Awaited<ReturnType<typeof fetchCatalogRowsForAi>>;
        lineQuantity: number | null;
    };

    const settled = await Promise.allSettled(
        pending.map(async (line): Promise<PhaseOk | null> => {
            const query = String(line.rawTerm ?? "").trim();
            if (!query) return null;
            const phase = await fetchCatalogRowsForAi(
                { query, categoryHint: null },
                {
                    admin: params.admin,
                    catalog: params.catalog,
                    companyId: params.companyId,
                    customerId: params.customerId,
                    userText: params.packagingContextText || query,
                    worklistLineId: line.id,
                    worklistLineQuantity: line.quantity ?? null,
                    batchContext: ctx,
                }
            );
            return {
                lineId: line.id,
                query,
                phase,
                lineQuantity: line.quantity ?? null,
            };
        })
    );

    const byLineId = new Map<string, PhaseOk>();
    let searchFailCount = 0;
    for (const item of settled) {
        if (item.status !== "fulfilled" || !item.value) {
            searchFailCount += 1;
            continue;
        }
        byLineId.set(item.value.lineId, item.value);
    }

    const allProductIds = [...byLineId.values()].flatMap((v) => v.phase.productIds);
    ctx = await enrichBatchSearchContextHabits({
        ctx,
        admin: params.admin,
        companyId: params.companyId,
        customerId: params.customerId,
        productIds: allProductIds,
    });

    /** Fold na ordem da worklist (determinístico). */
    const searchedLineIds: string[] = [];
    const uniqueHits: UniquePrepareHit[] = [];

    for (const line of pending) {
        const ok = byLineId.get(line.id);
        if (!ok) continue;
        searchedLineIds.push(line.id);

        const deps = {
            admin: params.admin,
            catalog: params.catalog,
            companyId: params.companyId,
            customerId: params.customerId,
            userText: params.packagingContextText || ok.query,
            worklistLineId: line.id,
            worklistLineQuantity: ok.lineQuantity,
            batchContext: ctx,
        };
        const habitSigla = habitSiglaForProductIds(
            ctx,
            ok.phase.rows.map((r) => r.produto_id)
        );
        const result = finalizeSearchProdutosForAi(ok.phase, deps, {
            companySiglas: ctx.companySiglas,
            habitSigla,
        });

        const applied = applySearchResultToLine({
            worklist,
            pendingPickGroups,
            allowlistIds,
            lineId: ok.lineId,
            query: ok.query,
            result,
        });
        worklist = applied.worklist;
        pendingPickGroups = applied.pendingPickGroups;
        allowlistIds = applied.allowlistIds;
        if (applied.uniquePrepareCandidate) {
            uniqueHits.push(applied.uniquePrepareCandidate);
        }
    }

    const coalesced = await coalescePrepareUniqueHits({
        admin: params.admin,
        companyId: params.companyId,
        customerId: params.customerId,
        worklist,
        allowlistIds,
        draft,
        hits: uniqueHits,
    });
    worklist = coalesced.worklist;
    allowlistIds = coalesced.allowlistIds;
    draft = coalesced.draft;

    worklist = expireExhaustedPendingSearchLines(worklist);
    pendingPickGroups = syncPendingPickGroupsFromWorklist({
        worklist,
        groups: pendingPickGroups,
    });

    return {
        state: {
            ...params.state,
            orderWorklist: worklist,
            pendingPickGroups,
            searchProdutoEmbalagemIds: allowlistIds,
            draft,
            pendingOutOfStockOffer: coalesced.outOfStockNames.length
                ? {
                      names: [
                          ...new Set([
                              ...(params.state.pendingOutOfStockOffer?.names ?? []),
                              ...coalesced.outOfStockNames,
                          ]),
                      ],
                  }
                : params.state.pendingOutOfStockOffer ?? null,
        },
        searchedLineIds,
        preparedLineIds: coalesced.preparedLineIds,
        prepareCallCount: coalesced.prepareCallCount,
        searchFailCount,
    };
}
