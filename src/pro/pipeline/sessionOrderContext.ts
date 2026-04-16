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
]);

/**
 * Há contexto de pedido activo (rascunho com itens ou passo de checkout).
 * Exclui `handover` e escolha de escalação — aí outras regras aplicam.
 */
export function isOrderSessionContinuityNeeded(session: ProSessionState): boolean {
    if (session.step === "handover" || session.step === "pro_escalation_choice") return false;
    if (session.draft?.items?.length) return true;
    return STEPS_IMPLYING_ORDER_SESSION.has(session.step);
}
