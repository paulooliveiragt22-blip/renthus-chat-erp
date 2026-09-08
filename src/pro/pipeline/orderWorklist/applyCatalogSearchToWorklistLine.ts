import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft, OrderWorklist, PendingPickGroup } from "@/src/types/contracts";
import type { SearchProdutosForAiResult } from "@/src/pro/adapters/ai/tools/searchProdutosForAi";
import { applySearchResultToLine } from "@/src/pro/pipeline/orderWorklist/applySearchResultToLine";
import { coalescePrepareUniqueHits } from "@/src/pro/pipeline/orderWorklist/coalescePrepareUniqueHits";

/**
 * Path da tool `search_produtos` (1 line): apply sync + prepare coalescido (1 item).
 */
export async function applyCatalogSearchToWorklistLine(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    worklist: OrderWorklist;
    pendingPickGroups: readonly PendingPickGroup[];
    allowlistIds: string[];
    draft: OrderDraft | null;
    lineId: string;
    query: string;
    result: SearchProdutosForAiResult;
}): Promise<{
    worklist: OrderWorklist;
    pendingPickGroups: PendingPickGroup[];
    allowlistIds: string[];
    draft: OrderDraft | null;
    prepared: boolean;
}> {
    const applied = applySearchResultToLine({
        worklist: params.worklist,
        pendingPickGroups: params.pendingPickGroups,
        allowlistIds: params.allowlistIds,
        lineId: params.lineId,
        query: params.query,
        result: params.result,
    });

    if (!applied.uniquePrepareCandidate) {
        return {
            worklist: applied.worklist,
            pendingPickGroups: applied.pendingPickGroups,
            allowlistIds: applied.allowlistIds,
            draft: params.draft,
            prepared: false,
        };
    }

    const coalesced = await coalescePrepareUniqueHits({
        admin: params.admin,
        companyId: params.companyId,
        customerId: params.customerId,
        worklist: applied.worklist,
        allowlistIds: applied.allowlistIds,
        draft: params.draft,
        hits: [applied.uniquePrepareCandidate],
    });

    return {
        worklist: coalesced.worklist,
        pendingPickGroups: applied.pendingPickGroups,
        allowlistIds: coalesced.allowlistIds,
        draft: coalesced.draft,
        prepared: coalesced.preparedLineIds.length > 0,
    };
}
