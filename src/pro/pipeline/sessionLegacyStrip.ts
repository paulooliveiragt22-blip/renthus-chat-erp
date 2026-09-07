/**
 * Drain-on-read/save: limpa campos do extract/bootstrap que não devem voltar ao hot path.
 */

import type { ProSessionState } from "@/src/types/contracts";

/**
 * Zera pagamento inferido (legado), filas bootstrap vazias e filas string de coleta
 * (ADR 0011 Fase 3 — worklist é canônica).
 * Preserva `bootstrapPendingClarifications` se ainda houver itens (sessões antigas).
 */
export function stripLegacyProSessionFields(state: ProSessionState): ProSessionState {
    const pending = state.bootstrapPendingClarifications ?? [];
    const hasPendingClarify = pending.length > 0;

    return {
        ...state,
        inferredPaymentMethod: null,
        bootstrapPendingClarifications: hasPendingClarify ? pending : [],
        bootstrapResolvedEmbalagemIds: hasPendingClarify
            ? state.bootstrapResolvedEmbalagemIds ?? []
            : [],
        /** Nunca regravar mentions; hydrate one-shot já migrou para worklist. */
        pendingOrderMentions: [],
        /** Sem writers no hot path — limpar; not_found vive na worklist. */
        pendingAskRepeatTerms: [],
        /** Qty/segmento só enquanto bootstrap drain ativo. */
        pendingClarifyQuantity: hasPendingClarify
            ? state.pendingClarifyQuantity ?? null
            : null,
        pendingClarifySegment: hasPendingClarify
            ? state.pendingClarifySegment ?? null
            : null,
    };
}
