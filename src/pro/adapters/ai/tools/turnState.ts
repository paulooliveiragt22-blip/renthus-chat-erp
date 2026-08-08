import type { OrderDraft } from "@/src/types/contracts";

/**
 * Estado do turno compartilhado entre as tools de um mesmo `generateText()` (Fase 3 da
 * migração Vercel AI SDK — ver docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md).
 *
 * Passado por closure (não por `experimental_context` do AI SDK): cada campo tem
 * exatamente UM tool "escritor", então não há risco de condição de corrida entre tool
 * calls paralelas na mesma step (`search_produtos` só escreve os campos de busca;
 * `prepare_order_draft` só escreve os de rascunho). Instância nova por chamada de
 * `run()` — nunca reaproveitada entre turnos/requests.
 */
export type SearchPickSummary = {
    embalagemId: string;
    label: string;
    price?: number | null;
    productName?: string | null;
};

export type TurnState = {
    /** Escrito só por prepare_order_draft (merge aditivo com o draft anterior). */
    currentDraft: OrderDraft | null;
    /** Escrito só por search_produtos; lido por prepare_order_draft (allowlist). */
    allowlistIds: string[];
    lastSearchPicks: SearchPickSummary[];
    emptySearchStreak: number;
    /** Escrito só por prepare_order_draft. */
    prepareInvokedThisTurn: boolean;
    /** Escrito só por search_produtos. */
    searchInvokedThisTurn: boolean;
    lastPrepareOutcome: { ok: boolean; errors: string[] } | null;
    /** Escrito só por `ai.service.ts` (entre steps, via `prepareStep`) — evita repetir o nudge. */
    forceNudgeInjected: boolean;
};

export function createInitialTurnState(seed: {
    allowlistIds: readonly string[];
    lastSearchPicks: readonly SearchPickSummary[];
    emptySearchStreak: number;
    currentDraft: OrderDraft | null;
}): TurnState {
    return {
        currentDraft: seed.currentDraft,
        allowlistIds: [...seed.allowlistIds],
        lastSearchPicks: [...seed.lastSearchPicks],
        emptySearchStreak: seed.emptySearchStreak,
        prepareInvokedThisTurn: false,
        searchInvokedThisTurn: false,
        lastPrepareOutcome: null,
        forceNudgeInjected: false,
    };
}
