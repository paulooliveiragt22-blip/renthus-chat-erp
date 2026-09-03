import type { DraftAddress, OrderDraft, ProSessionState } from "@/src/types/contracts";
import { isPickupDraft } from "@/lib/delivery/fulfillment";

/** Endereço mínimo para entrega (rua, número, bairro, cidade, UF — alinhado a prepare/slots). */
export function isAddressStructurallyComplete(address: DraftAddress | null): boolean {
    if (!address) return false;
    const uf = address.estado?.trim().toUpperCase() ?? "";
    return Boolean(
        address.logradouro?.trim() &&
            address.numero?.trim() &&
            address.bairro?.trim() &&
            address.cidade?.trim() &&
            uf.length === 2
    );
}

/** Total do rascunho abaixo do pedido mínimo de entrega (quando a política define um). */
export function isDraftBelowMinimumOrder(draft: OrderDraft): boolean {
    if (isPickupDraft(draft)) return false;
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
 *
 * C1.5: entrega exige endereço **estruturalmente** completo (não só `Boolean(address)`).
 */
export function isDraftStructurallyCompleteForFinalize(draft: OrderDraft): boolean {
    const addressOk =
        isPickupDraft(draft) ||
        (draft.fulfillmentType === "delivery" && isAddressStructurallyComplete(draft.address));
    return (
        draft.items.length > 0 &&
        addressOk &&
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
