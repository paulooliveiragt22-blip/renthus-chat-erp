import {
    advanceLineAfterSearch,
    listLinesByStatus,
    MAX_SEARCH_ATTEMPTS_PER_LINE,
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
    /** ADR 0011 D8 — clarify-first: não queimar attempts dos irmãos. */
    if (listLinesByStatus(params.worklist, "ambiguous").length > 0) return false;
    const pending = listLinesByStatus(params.worklist, "pending_search").filter(
        (l) => (l.searchAttempts ?? 0) < MAX_SEARCH_ATTEMPTS_PER_LINE
    );
    if (pending.length > 0) return true;
    /** Hit único com qty ainda em `searching` (prepare não commitou) → re-buscar/reconciliar. */
    return listLinesByStatus(params.worklist, "searching").length > 0;
}

export type { ExtractedOrderLineInput };
