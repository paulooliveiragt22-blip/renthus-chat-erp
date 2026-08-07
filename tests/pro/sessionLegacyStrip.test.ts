import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripLegacyProSessionFields } from "../../src/pro/pipeline/sessionLegacyStrip";
import type { ProSessionState } from "../../src/types/contracts";

function baseState(over: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_idle",
        customerId: null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...over,
    };
}

describe("stripLegacyProSessionFields", () => {
    it("zera inferredPaymentMethod e limpa bootstrap quando fila vazia", () => {
        const out = stripLegacyProSessionFields(
            baseState({
                inferredPaymentMethod: "pix",
                bootstrapResolvedEmbalagemIds: ["a", "b"],
                bootstrapPendingClarifications: [],
            })
        );
        assert.equal(out.inferredPaymentMethod, null);
        assert.deepEqual(out.bootstrapResolvedEmbalagemIds, []);
        assert.deepEqual(out.bootstrapPendingClarifications, []);
    });

    it("preserva bootstrap resolvido quando ainda há clarificação pendente", () => {
        const pending = [
            {
                segment: "heineken",
                picks: [{ embalagemId: "e1", label: "UN" }],
            },
        ];
        const out = stripLegacyProSessionFields(
            baseState({
                bootstrapResolvedEmbalagemIds: ["keep-me"],
                bootstrapPendingClarifications: pending,
            })
        );
        assert.deepEqual(out.bootstrapResolvedEmbalagemIds, ["keep-me"]);
        assert.equal(out.bootstrapPendingClarifications?.length, 1);
    });
});
