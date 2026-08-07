import type { OrderDraft, ProSessionState } from "@/src/types/contracts";

/** Total do rascunho abaixo do pedido mínimo de entrega (quando a política define um). */
export function isDraftBelowMinimumOrder(draft: OrderDraft): boolean {
    const min = draft.deliveryMinOrder;
    if (min == null || !(min > 0)) return false;
    return draft.grandTotal < min;
}

/**
 * R1 (fundação): uma única definição de “draft mínimo” antes de chamar `OrderService.createFromDraft`
 * após confirmação explícita. Mantém `orderStage` alinhado a testes e métricas de pré-condição.
 * Também nunca considera "pronto" um rascunho abaixo do pedido mínimo de entrega — é a mesma
 * checagem usada pelo slot machine (`resolveProStepFromDraft`) e serve de rede de segurança
 * final antes de criar o pedido, caso o passo da sessão fique dessincronizado.
 */
export function isDraftStructurallyCompleteForFinalize(draft: OrderDraft): boolean {
    return (
        draft.items.length > 0 &&
        Boolean(draft.address) &&
        Boolean(draft.paymentMethod) &&
        !isDraftBelowMinimumOrder(draft)
    );
}

/** Há `customerId` e `draft` persistidos (podem ainda falhar `isDraftStructurallyCompleteForFinalize`). */
export function hasPersistedDraftAndCustomer(
    state: ProSessionState
): state is ProSessionState & { draft: OrderDraft; customerId: string } {
    return Boolean(state.draft && state.customerId);
}

/** Gate mínimo para permitir tentativa de finalização: rascunho persistido. */
export function hasPersistedDraft(
    state: ProSessionState
): state is ProSessionState & { draft: OrderDraft } {
    return Boolean(state.draft);
}
