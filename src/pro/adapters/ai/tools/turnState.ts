import type { OrderDraft, OrderWorklist, PendingPickGroup } from "@/src/types/contracts";
import {
    createEmptyOrderWorklist,
    hydrateWorklistFromLegacyMentions,
} from "@/src/pro/domain/orderWorklist/orderWorklist";

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
    /**
     * Cache efêmero de opções UI (botões). Ambíguo multi-embalagem usa `pendingPickGroups`
     * / worklist `ambiguous` (ADR 0011 Fase 3).
     */
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
    /** Escrito só por `ai.service.ts` — evita repetir o nudge de search_produtos p/ item pendente. */
    forceSearchPendingNudgeInjected: boolean;
    /** Fonte canônica de coleta (ADR 0011). */
    orderWorklist: OrderWorklist;
    /**
     * Queries já passadas a `search_produtos` neste turno.
     */
    searchedProductQueriesThisTurn: string[];
    /**
     * Grupos de embalagem (UN/CX/Fardo) — projection de lines `ambiguous` com `lineId`.
     */
    pendingPickGroups: PendingPickGroup[];
    /** Escrito só por `ai.service.ts` — evita repetir o nudge de resolve_pending_picks no mesmo turno. */
    forceResolvePendingPicksNudgeInjected: boolean;
    /** C2.4 — acumuladores do turno (flush no pipeline após AI). */
    matchingMetrics: {
        prepareBlockedAllowlist: number;
        searchHitsZero: number;
    };
    /** Turno em que serverResolvePendingPicks já tratou pick — sem force-search (ADR 0011 D5). */
    pickResolveTurn: boolean;
    /**
     * Nomes sem estoque reportados pelo prepare neste turno (flag vender_com_estoque_zero=false).
     * Post-process junta com strip físico do draft.
     */
    pendingOutOfStockOffer: { names: string[] } | null;
};

export function createInitialTurnState(seed: {
    allowlistIds: readonly string[];
    lastSearchPicks: readonly SearchPickSummary[];
    emptySearchStreak: number;
    currentDraft: OrderDraft | null;
    /** @deprecated Hydrate one-shot → worklist; não usar como fila ativa. */
    pendingOrderMentions?: readonly string[];
    orderWorklist?: OrderWorklist | null;
    pendingPickGroups?: readonly PendingPickGroup[];
    pickResolveTurn?: boolean;
}): TurnState {
    const orderWorklist =
        seed.orderWorklist && seed.orderWorklist.lines.length > 0
            ? seed.orderWorklist
            : hydrateWorklistFromLegacyMentions({
                  mentions: seed.pendingOrderMentions ?? [],
                  existing: seed.orderWorklist,
              });
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
        orderWorklist: orderWorklist.lines.length
            ? orderWorklist
            : createEmptyOrderWorklist(),
        searchedProductQueriesThisTurn: [],
        pendingPickGroups: [...(seed.pendingPickGroups ?? [])].map((g, i) =>
            g.lineId
                ? g
                : {
                      ...g,
                      lineId: `legacy_pick_${i}_${g.productKey}`,
                  }
        ),
        forceResolvePendingPicksNudgeInjected: false,
        matchingMetrics: { prepareBlockedAllowlist: 0, searchHitsZero: 0 },
        pickResolveTurn: seed.pickResolveTurn === true,
        pendingOutOfStockOffer: null,
    };
}
