import {
    worklistBlocksCheckout,
    worklistHasOrphanInDraftLines,
} from "@/src/pro/domain/orderWorklist/orderWorklist";
import type { OrderWorklist, ProSessionState } from "@/src/types/contracts";

export function worklistCheckoutGate(params: {
    worklist?: OrderWorklist | null;
    state?: Pick<ProSessionState, "orderWorklist" | "pendingPickGroups" | "lastSearchPicks" | "draft">;
}): { blocked: boolean; reason: string | null } {
    const wl = params.worklist ?? params.state?.orderWorklist ?? null;
    if (worklistBlocksCheckout(wl)) {
        return { blocked: true, reason: "worklist_blocks_checkout" };
    }
    if (
        params.state !== undefined &&
        worklistHasOrphanInDraftLines(wl, params.state.draft)
    ) {
        return { blocked: true, reason: "worklist_orphan_in_draft" };
    }
    // Legado transitório: lastSearchPicks>=2 sem draft (ADR 0011 D5)
    const picks = params.state?.lastSearchPicks?.length ?? 0;
    const draftItems = params.state?.draft?.items?.length ?? 0;
    if (picks >= 2 && draftItems === 0 && (params.state?.pendingPickGroups?.length ?? 0) === 0) {
        return { blocked: true, reason: "legacy_last_search_picks" };
    }
    return { blocked: false, reason: null };
}
