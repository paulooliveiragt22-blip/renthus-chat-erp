import {
    advanceLineAfterSearch,
    listLinesByStatus,
    type ExtractedOrderLineInput,
} from "@/src/pro/domain/orderWorklist/orderWorklist";
import type { OrderWorklist } from "@/src/types/contracts";

export function advanceWorklistAfterSearch(params: {
    worklist: OrderWorklist;
    query: string;
    hitCount: number;
    productKey?: string | null;
    produtoEmbalagemId?: string | null;
    lineId?: string | null;
    nowIso?: string;
}): OrderWorklist {
    return advanceLineAfterSearch(params);
}

export function shouldForceSearchWorklist(params: {
    worklist: OrderWorklist | null | undefined;
    /** Turno só a resolver pick já listado — não force-search. */
    pickResolveTurn?: boolean;
}): boolean {
    if (params.pickResolveTurn) return false;
    return listLinesByStatus(params.worklist, "pending_search").length > 0;
}

export type { ExtractedOrderLineInput };
