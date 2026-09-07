/**
 * Resumo compacto da OrderWorklist para `pipeline_turn_traces.worklist_summary`
 * (ADR 0011 Fase 4 — reason codes sem poluir state_before/after).
 */
import type { OrderWorklist, OrderWorklistLineStatus, ProSessionState } from "@/src/types/contracts";
import {
    listLinesByStatus,
    worklistBlocksCheckout,
} from "@/src/pro/domain/orderWorklist/orderWorklist";
import { worklistCheckoutGate } from "@/src/pro/pipeline/orderWorklist/worklistCheckoutGate";

export type WorklistTraceSummary = {
    lineCount: number;
    byStatus: Partial<Record<OrderWorklistLineStatus, number>>;
    blocksCheckout: boolean;
    checkoutBlockReason: string | null;
    pendingSearchTerms: string[];
    awaitingQtyTerms: string[];
    ambiguousKeys: string[];
    notFoundTerms: string[];
    sealedHash: string | null;
    /** Soma de searchAttempts nas lines (proxy de searches quando métrica do turno não veio). */
    searchAttemptsTotal: number;
    reasons: string[];
};

function countByStatus(wl: OrderWorklist | null | undefined): Partial<Record<OrderWorklistLineStatus, number>> {
    const out: Partial<Record<OrderWorklistLineStatus, number>> = {};
    for (const line of wl?.lines ?? []) {
        out[line.status] = (out[line.status] ?? 0) + 1;
    }
    return out;
}

export function buildWorklistTraceSummary(
    state: ProSessionState | null | undefined
): WorklistTraceSummary | null {
    const wl = state?.orderWorklist ?? null;
    if (!wl || !(wl.lines?.length > 0)) {
        const gate = worklistCheckoutGate({ state: state ?? undefined });
        if (!gate.blocked) return null;
        return {
            lineCount: 0,
            byStatus: {},
            blocksCheckout: true,
            checkoutBlockReason: gate.reason,
            pendingSearchTerms: [],
            awaitingQtyTerms: [],
            ambiguousKeys: [],
            notFoundTerms: [],
            sealedHash: null,
            searchAttemptsTotal: 0,
            reasons: gate.reason ? [gate.reason] : ["worklist_blocks_checkout"],
        };
    }

    const byStatus = countByStatus(wl);
    const gate = worklistCheckoutGate({ worklist: wl, state: state ?? undefined });
    const reasons: string[] = [];
    if (gate.blocked && gate.reason) reasons.push(gate.reason);
    if ((byStatus.pending_search ?? 0) > 0) reasons.push("pending_search");
    if ((byStatus.ambiguous ?? 0) > 0) reasons.push("ambiguous");
    if ((byStatus.awaiting_qty ?? 0) > 0) reasons.push("awaiting_qty");
    if ((byStatus.not_found ?? 0) > 0) reasons.push("not_found");

    return {
        lineCount: wl.lines.length,
        byStatus,
        blocksCheckout: worklistBlocksCheckout(wl) || gate.blocked,
        checkoutBlockReason: gate.reason,
        pendingSearchTerms: listLinesByStatus(wl, "pending_search").map((l) => l.rawTerm),
        awaitingQtyTerms: listLinesByStatus(wl, "awaiting_qty").map((l) => l.rawTerm),
        ambiguousKeys: listLinesByStatus(wl, "ambiguous").map(
            (l) => l.productKey ?? l.pendingPickGroupKey ?? l.rawTerm
        ),
        notFoundTerms: listLinesByStatus(wl, "not_found").map((l) => l.rawTerm),
        sealedHash: wl.sealedFromUserTextHash ?? null,
        searchAttemptsTotal: wl.lines.reduce((n, l) => n + (l.searchAttempts ?? 0), 0),
        reasons: [...new Set(reasons)],
    };
}
