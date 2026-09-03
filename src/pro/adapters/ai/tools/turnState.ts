import type { OrderDraft, PendingPickGroup } from "@/src/types/contracts";

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
    /** Nº de chamadas search_produtos neste turno (escrito só por search_produtos). */
    searchCallCount: number;
    lastPrepareOutcome: { ok: boolean; errors: string[] } | null;
    /** Escrito só por `ai.service.ts` (entre steps, via `prepareStep`) — evita repetir o nudge de prepare_order_draft. */
    forcePrepareNudgeInjected: boolean;
    /** Escrito só por `ai.service.ts` — evita repetir o nudge de search_produtos p/ item pendente (carryover de turno anterior). */
    forceSearchPendingNudgeInjected: boolean;
    /**
     * Termos de produto que o cliente citou e ainda não foram buscados — fonte de verdade é o
     * campo obrigatório `outros_produtos_pendentes` que o próprio `search_produtos` exige do
     * modelo a cada chamada (schema-enforced, não depende do modelo "lembrar" depois). Semeado
     * com o carryover do turno anterior (`ProSessionState.pendingOrderMentions`) e sobrescrito
     * (não acumulado) a cada nova chamada de search_produtos, que reflete o conhecimento mais
     * atual do modelo. Ver `shouldForceSearchForDeclaredPendingTerms` em `ai.service.ts`.
     */
    pendingTermsFromSearch: string[];
    /**
     * Grupos de embalagem (UN/CX/Fardo) ainda ambíguos para produtos distintos citados no
     * mesmo turno — ver `pendingPickGroups.ts`. Escrito por `search_produtos` (upsert por
     * produto) e por `resolve_pending_picks` (remove grupo resolvido). Semeado com o
     * carryover do turno anterior (`ProSessionState.pendingPickGroups`).
     */
    pendingPickGroups: PendingPickGroup[];
    /** Escrito só por `ai.service.ts` — evita repetir o nudge de resolve_pending_picks no mesmo turno. */
    forceResolvePendingPicksNudgeInjected: boolean;
    /** C2.4 — acumuladores do turno (flush no pipeline após AI). */
    matchingMetrics: {
        prepareBlockedAllowlist: number;
        searchHitsZero: number;
    };
};

export function createInitialTurnState(seed: {
    allowlistIds: readonly string[];
    lastSearchPicks: readonly SearchPickSummary[];
    emptySearchStreak: number;
    currentDraft: OrderDraft | null;
    pendingOrderMentions?: readonly string[];
    pendingPickGroups?: readonly PendingPickGroup[];
}): TurnState {
    return {
        currentDraft: seed.currentDraft,
        allowlistIds: [...seed.allowlistIds],
        lastSearchPicks: [...seed.lastSearchPicks],
        emptySearchStreak: seed.emptySearchStreak,
        prepareInvokedThisTurn: false,
        searchInvokedThisTurn: false,
        searchCallCount: 0,
        lastPrepareOutcome: null,
        forcePrepareNudgeInjected: false,
        forceSearchPendingNudgeInjected: false,
        pendingTermsFromSearch: [...(seed.pendingOrderMentions ?? [])],
        pendingPickGroups: [...(seed.pendingPickGroups ?? [])],
        forceResolvePendingPicksNudgeInjected: false,
        matchingMetrics: { prepareBlockedAllowlist: 0, searchHitsZero: 0 },
    };
}
