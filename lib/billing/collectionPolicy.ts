/**
 * Política de coleta de mensalidade (BN-13). A matriz temporal D0–D7 é canônica
 * NO BANCO em fn_billing_collection_action (ADR-0006 D12 / governanca Regra 2).
 * `resolveCollectionAction` abaixo é o espelho puro (usado em testes de spec);
 * o cron usa `resolveCollectionActionDb`, que lê a decisão do banco.
 *
 * Matriz (clarificação 2026-09-04):
 *   D0            → coletar (card se houver; senão PIX)
 *   D1 / D3 / D5  → com cartão: retry card; sem cartão: só notificar (WA)
 *   D2 / D4 / D6  → noop
 *   D7+           → block
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type CollectionChannel = "card" | "pix";

export type CollectionAttemptLabel = "d0" | "d1" | "d3" | "d5";

export type CollectionAction =
    | { type: "collect"; prefer: CollectionChannel; attemptLabel: CollectionAttemptLabel }
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

/** Espelho puro da matriz do banco (fonte de verdade = fn_billing_collection_action). */
export function resolveCollectionAction(input: CollectionPolicyInput): CollectionAction {
    const d = Math.max(0, Math.floor(input.daysOverdue));

    if (d >= 7) return { type: "block" };

    if (d === 0) {
        return {
            type: "collect",
            prefer: input.hasDefaultCard ? "card" : "pix",
            attemptLabel: "d0",
        };
    }

    if (d === 1 || d === 3 || d === 5) {
        if (input.hasDefaultCard) {
            return {
                type: "collect",
                prefer: "card",
                attemptLabel: (`d${d}` as CollectionAttemptLabel),
            };
        }
        return { type: "notify_only", day: d };
    }

    return { type: "noop" };
}

/**
 * Resolve a ação de coleta consultando o banco (fonte canônica). Usado pelo cron.
 * Requer client com role que possa executar a função (service_role).
 */
export async function resolveCollectionActionDb(
    admin: SupabaseClient,
    input: { daysOverdue: number; hasDefaultCard: boolean }
): Promise<CollectionAction> {
    const { data, error } = await admin.rpc("fn_billing_collection_action", {
        p_days_overdue: Math.max(0, Math.floor(input.daysOverdue)),
        p_has_default_card: input.hasDefaultCard,
    });
    if (error) throw new Error(error.message);

    const j = (data ?? {}) as {
        type?: string;
        prefer?: string;
        label?: string;
        day?: number;
    };

    switch (j.type) {
        case "block":
            return { type: "block" };
        case "collect":
            return {
                type: "collect",
                prefer: j.prefer === "card" ? "card" : "pix",
                attemptLabel: (j.label as CollectionAttemptLabel) ?? "d0",
            };
        case "notify":
            return { type: "notify_only", day: Number(j.day ?? 0) };
        default:
            return { type: "noop" };
    }
}

/** Trial vencido: setup fee > 0 → setup; senão first invoice (pending_payment). */
export function resolveTrialDueKind(setupPriceCents: number): "setup" | "first_invoice" {
    return setupPriceCents > 0 ? "setup" : "first_invoice";
}
