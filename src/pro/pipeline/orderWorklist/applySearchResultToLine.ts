import type { OrderDraft, OrderWorklist, PendingPickGroup } from "@/src/types/contracts";
import type { SearchProdutosForAiResult } from "@/src/pro/adapters/ai/tools/searchProdutosForAi";
import { advanceWorklistAfterSearch } from "@/src/pro/pipeline/orderWorklist/advanceWorklistAfterSearch";
import { upsertPendingPickGroupForLine } from "@/src/pro/pipeline/orderWorklist/syncPendingPickGroupsFromWorklist";
import { unionAllowlistIds } from "@/src/pro/pipeline/mergeOrderDraft";

/**
 * Aplica resultado de busca à worklist **sem** prepare (sync / fold-safe).
 * Hits únicos com qty ficam em `searching` até `coalescePrepareUniqueHits`.
 */
export function applySearchResultToLine(params: {
    worklist: OrderWorklist;
    pendingPickGroups: readonly PendingPickGroup[];
    allowlistIds: string[];
    lineId: string;
    query: string;
    result: SearchProdutosForAiResult;
}): {
    worklist: OrderWorklist;
    pendingPickGroups: PendingPickGroup[];
    allowlistIds: string[];
    /** Candidato a prepare coalescido (hit único + qty). */
    uniquePrepareCandidate: {
        lineId: string;
        produtoEmbalagemId: string;
        quantity: number;
    } | null;
} {
    const hitCount = params.result.wasEmpty ? 0 : params.result.allowlistIds.length;
    const productKey = params.result.pendingPickGroup?.productKey ?? null;
    const uniqueId =
        hitCount === 1 && !params.result.pendingPickGroup
            ? params.result.allowlistIds[0] ?? null
            : null;

    let worklist = advanceWorklistAfterSearch({
        worklist: params.worklist,
        query: params.query,
        hitCount: params.result.pendingPickGroup ? Math.max(hitCount, 2) : hitCount,
        productKey,
        produtoEmbalagemId: uniqueId,
        lineId: params.lineId,
    });

    const allowlistIds = unionAllowlistIds(params.allowlistIds, params.result.allowlistIds);
    let pendingPickGroups = [...params.pendingPickGroups];

    if (params.result.pendingPickGroup) {
        pendingPickGroups = upsertPendingPickGroupForLine({
            groups: pendingPickGroups,
            group: {
                ...params.result.pendingPickGroup,
                lineId: params.lineId,
            },
        });
    }

    const advancedLine = worklist.lines.find((l) => l.id === params.lineId) ?? null;
    const lineQty =
        advancedLine?.quantity != null && advancedLine.quantity >= 1
            ? Math.floor(advancedLine.quantity)
            : null;

    const uniquePrepareCandidate =
        uniqueId && lineQty != null
            ? { lineId: params.lineId, produtoEmbalagemId: uniqueId, quantity: lineQty }
            : null;

    return { worklist, pendingPickGroups, allowlistIds, uniquePrepareCandidate };
}

export type { OrderDraft };
