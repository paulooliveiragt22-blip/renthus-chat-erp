import type { OrderDraft, ProSessionState } from "@/src/types/contracts";

/**
 * R1 (fundação): uma única definição de “draft mínimo” antes de chamar `OrderService.createFromDraft`
 * após confirmação explícita. Mantém `orderStage` alinhado a testes e métricas de pré-condição.
 */
export function isDraftStructurallyCompleteForFinalize(draft: OrderDraft): boolean {
    return draft.items.length > 0 && Boolean(draft.address) && Boolean(draft.paymentMethod);
}

/** Há `customerId` e `draft` persistidos (podem ainda falhar `isDraftStructurallyCompleteForFinalize`). */
export function hasPersistedDraftAndCustomer(
    state: ProSessionState
): state is ProSessionState & { draft: OrderDraft; customerId: string } {
    return Boolean(state.draft && state.customerId);
}
