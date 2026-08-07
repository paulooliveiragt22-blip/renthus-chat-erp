/**
 * Drain-on-read/save: limpa campos do extract/bootstrap que não devem voltar ao hot path.
 */

import type { ProSessionState } from "@/src/types/contracts";

/**
 * Zera pagamento inferido (legado) e filas bootstrap vazias.
 * Preserva `bootstrapPendingClarifications` se ainda houver itens (sessões antigas em clarificação).
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
    };
}
