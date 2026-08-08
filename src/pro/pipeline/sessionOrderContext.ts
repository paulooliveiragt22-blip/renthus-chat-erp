import type { ProSessionState, ProStep } from "@/src/types/contracts";

/**
 * Passos em que uma resposta curta ("uma caixa", "2", "sim") deve continuar no fluxo de pedido,
 * e não cair no menu inicial por `greeting` / `unknown` / `faq`.
 */
const STEPS_IMPLYING_ORDER_SESSION: ReadonlySet<ProStep> = new Set([
    "pro_collecting_order",
    "pro_awaiting_address_confirmation",
    "pro_awaiting_payment_method",
    "pro_awaiting_change_amount",
    "pro_awaiting_confirmation",
    "pro_awaiting_phone",
]);

/**
 * Há contexto de pedido activo (rascunho com itens ou passo de checkout).
 * Exclui `handover` e escolha de escalação — aí outras regras aplicam.
 */
export function isOrderSessionContinuityNeeded(session: ProSessionState): boolean {
    if (session.step === "handover" || session.step === "pro_escalation_choice") return false;
    if (session.draft?.items?.length) return true;
    if ((session.lastSearchPicks?.length ?? 0) >= 2) return true;
    return STEPS_IMPLYING_ORDER_SESSION.has(session.step);
}

/**
 * Saudação / FAQ sem itens no carrinho: descarta UI de clarificação residual
 * (ex.: `oi` após abandono de pick UN/CX) para não misturar boas-vindas com botões velhos.
 */
export function clearStaleClarifyUiIfNoDraft(session: ProSessionState): ProSessionState {
    if (session.draft?.items?.length) return session;
    const hasClarifyUi =
        (session.lastSearchPicks?.length ?? 0) > 0 ||
        (session.bootstrapPendingClarifications?.length ?? 0) > 0 ||
        (session.searchProdutoEmbalagemIds?.length ?? 0) > 0 ||
        session.pendingClarifyQuantity != null ||
        session.pendingClarifySegment != null ||
        (session.pendingAskRepeatTerms?.length ?? 0) > 0 ||
        (session.pendingOrderMentions?.length ?? 0) > 0;
    if (!hasClarifyUi) return session;
    return {
        ...session,
        lastSearchPicks: [],
        searchProdutoEmbalagemIds: [],
        bootstrapPendingClarifications: [],
        bootstrapResolvedEmbalagemIds: [],
        pendingClarifyQuantity: null,
        pendingClarifySegment: null,
        pendingAskRepeatTerms: [],
        pendingOrderMentions: [],
        emptySearchStreak: 0,
        step:
            session.step === "pro_collecting_order" || session.step === "pro_idle"
                ? "pro_idle"
                : session.step,
    };
}
