import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createInitialTurnState } from "../../src/pro/adapters/ai/tools/turnState";
import {
    hydrateWorklistFromLegacyMentions,
    pendingSearchTermsFromWorklist,
} from "../../src/pro/domain/orderWorklist/orderWorklist";
import { shouldForceSearchWorklist } from "../../src/pro/pipeline/orderWorklist/advanceWorklistAfterSearch";

describe("createInitialTurnState hydrate", () => {
    it("hydrates mentions into pending_search", () => {
        const wl = hydrateWorklistFromLegacyMentions({ mentions: ["skol"] });
        assert.equal(wl.lines.length, 1);
        const ts = createInitialTurnState({
            allowlistIds: [],
            lastSearchPicks: [],
            emptySearchStreak: 0,
            currentDraft: null,
            pendingOrderMentions: ["skol"],
            orderWorklist: wl,
        });
        assert.deepEqual(pendingSearchTermsFromWorklist(ts.orderWorklist), ["skol"]);
        assert.equal(shouldForceSearchWorklist({ worklist: ts.orderWorklist }), true);
    });

    it("hydrates from mentions alone when orderWorklist null", () => {
        const ts = createInitialTurnState({
            allowlistIds: [],
            lastSearchPicks: [],
            emptySearchStreak: 0,
            currentDraft: null,
            pendingOrderMentions: ["skol"],
            orderWorklist: null,
        });
        assert.deepEqual(pendingSearchTermsFromWorklist(ts.orderWorklist), ["skol"]);
    });
});
