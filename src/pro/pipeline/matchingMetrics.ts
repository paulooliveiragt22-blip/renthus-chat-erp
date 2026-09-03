/**
 * Helpers de telemetria do pilar Matching (C2.4) — puros, sem I/O.
 */

/** Erros de prepare que indicam SKU fora da allowlist de search. */
export function countAllowlistRejectionErrors(errors: readonly string[]): number {
    let n = 0;
    for (const e of errors) {
        const msg = String(e ?? "");
        if (
            /não consta na última busca/i.test(msg) ||
            /nao consta na ultima busca/i.test(msg) ||
            /Faça search_produtos nesta conversa/i.test(msg) ||
            /Faca search_produtos nesta conversa/i.test(msg) ||
            /deve ser o UUID \(campo id\) copiado/i.test(msg)
        ) {
            n += 1;
        }
    }
    return n;
}

export const MATCHING_METRICS = {
    prepareBlockedAllowlist: "pro_pipeline.prepare_blocked_allowlist",
    searchHitsZero: "pro_pipeline.search_hits_zero",
    pendingPickAbandon: "pro_pipeline.pending_pick_abandon",
} as const;
