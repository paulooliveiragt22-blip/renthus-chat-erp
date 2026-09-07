import {
    findLineById,
    findLineMatchingQuery,
    termsReferToSame,
} from "./orderWorklist";
import type { OrderWorklist, OrderWorklistLine } from "@/src/types/contracts";

export { findLineById, findLineMatchingQuery, termsReferToSame };

/** Resolve line alvo de um search (query e/ou lineId explícito da tool). */
export function matchWorklistLineForSearch(params: {
    worklist: OrderWorklist | null | undefined;
    query: string;
    lineId?: string | null;
}): OrderWorklistLine | null {
    if (params.lineId) {
        const byId = findLineById(params.worklist, params.lineId);
        if (byId) return byId;
    }
    return findLineMatchingQuery(params.worklist, params.query);
}

export function matchWorklistLineByProductKey(params: {
    worklist: OrderWorklist | null | undefined;
    productKey: string;
}): OrderWorklistLine | null {
    const key = String(params.productKey ?? "").trim();
    if (!key) return null;
    return (
        (params.worklist?.lines ?? []).find(
            (l) =>
                (l.status === "ambiguous" || l.status === "awaiting_qty") &&
                l.productKey === key
        ) ?? null
    );
}
