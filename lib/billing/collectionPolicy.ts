/**
 * Política pura de coleta de mensalidade (card-first + retries D1/D3 + block D5+).
 * Sem I/O — usada pelo cron e testes.
 */

export type CollectionChannel = "card" | "pix";

export type CollectionAction =
    | { type: "collect"; prefer: CollectionChannel; attemptLabel: "d0" | "d1" | "d3" }
    | { type: "notify_only"; day: number }
    | { type: "block" }
    | { type: "noop" };

export type CollectionPolicyInput = {
    /** Dias desde due_at (floor). 0 = no dia do vencimento. */
    daysOverdue: number;
    hasDefaultCard: boolean;
    /** Já existe invoice pending deste ciclo. */
    hasPendingInvoice: boolean;
};

/**
 * D0: coletar (card se houver default; senão PIX).
 * D1/D3: retry card se houver default; senão só notificar (PIX já deve existir).
 * D2/D4: noop (ou notify_only se quiser WA extra — hoje só 1/3/5).
 * D5+: block.
 */
export function resolveCollectionAction(input: CollectionPolicyInput): CollectionAction {
    const d = Math.max(0, Math.floor(input.daysOverdue));

    if (d >= 5) return { type: "block" };

    if (d === 0) {
        return {
            type: "collect",
            prefer: input.hasDefaultCard ? "card" : "pix",
            attemptLabel: "d0",
        };
    }

    if (d === 1 || d === 3) {
        if (input.hasDefaultCard) {
            return {
                type: "collect",
                prefer: "card",
                attemptLabel: d === 1 ? "d1" : "d3",
            };
        }
        return { type: "notify_only", day: d };
    }

    return { type: "noop" };
}

/** Trial vencido: setup fee > 0 → setup; senão first invoice (pending_payment). */
export function resolveTrialDueKind(setupPriceCents: number): "setup" | "first_invoice" {
    return setupPriceCents > 0 ? "setup" : "first_invoice";
}
