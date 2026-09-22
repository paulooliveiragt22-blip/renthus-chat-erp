import type { DraftAddress, OrderDraft, ProSessionState, ProStep } from "@/src/types/contracts";
import { isPickupDraft } from "@/lib/delivery/fulfillment";
import {
    isAddressStructurallyComplete,
    isDraftBelowMinimumOrder,
    isDraftStructurallyCompleteForFinalize,
} from "./orderDraftGate";
import { listLinesByStatus } from "@/src/pro/domain/orderWorklist/orderWorklist";

/** Re-export — canónico em `orderDraftGate` (C1.5 finalize + slots). */
export { isAddressStructurallyComplete } from "./orderDraftGate";

/** Impressão digital do bloco de endereço + vínculo salvo (para invalidar confirmação na UI). */
export function deliveryAddressFingerprint(address: DraftAddress | null): string {
    if (!address) return "";
    return [
        address.logradouro?.trim() ?? "",
        address.numero?.trim() ?? "",
        address.bairro?.trim() ?? "",
        address.cidade?.trim() ?? "",
        address.estado?.trim().toUpperCase() ?? "",
        address.enderecoClienteId ?? "",
    ].join("|");
}

/** Itens + endereço: alteração invalida `deliveryAddressUiConfirmed`. */
export function orderDraftFingerprintForAddressConfirm(draft: OrderDraft | null): string {
    if (!draft) return "";
    const itemsKey = draft.items.map((i) => `${i.produtoEmbalagemId}:${i.quantity}`).join(",");
    return `${deliveryAddressFingerprint(draft.address)}#${itemsKey}`;
}

/** Itens + endereço + modalidade: alteração invalida o Confirmar do resumo. */
export function cartReviewFingerprint(draft: OrderDraft | null): string {
    if (!draft) return "";
    return `${orderDraftFingerprintForAddressConfirm(draft)}#${draft.fulfillmentType ?? ""}`;
}

export function isCartReviewHoldStep(step: ProStep): boolean {
    return step === "pro_awaiting_cart_review";
}

/**
 * Pagamento só conta no slot depois do resumo confirmado.
 * Evita a IA pular o resumo com `prepare_order_draft(paymentMethod)`.
 */
export function effectiveCheckoutPaymentMethod(
    draft: OrderDraft | null,
    cartReviewAcknowledged: boolean | undefined
): OrderDraft["paymentMethod"] {
    if (!cartReviewAcknowledged) return null;
    return draft?.paymentMethod ?? null;
}

/** Recalcula o ack do resumo se o draft mudou depois do Confirmar. */
export function withCartReviewValidity(state: ProSessionState): ProSessionState {
    const fp = cartReviewFingerprint(state.draft);
    const ack =
        state.cartReviewAcknowledged === true &&
        Boolean(fp) &&
        state.cartReviewFingerprint === fp;
    return {
        ...state,
        cartReviewAcknowledged: ack,
        cartReviewFingerprint: ack ? fp : null,
    };
}

/**
 * Confirmar do resumo: libera o pagamento efetivo.
 * Se o cliente já tinha dito PIX/cartão/dinheiro na mensagem (payment no draft),
 * mantém — não zera para forçar botões de novo.
 */
export function acknowledgeCartReview(state: ProSessionState): ProSessionState {
    if (!state.draft) return state;
    const draft: OrderDraft = {
        ...state.draft,
        pendingConfirmation: false,
    };
    const fp = cartReviewFingerprint(draft);
    return withResolvedSlotStep({
        ...state,
        draft,
        cartReviewAcknowledged: true,
        cartReviewFingerprint: fp,
        checkoutEditHold: false,
    });
}

/**
 * @deprecated Hold de endereço na UI removido: com rua+número+bairro(+cidade/UF) resolvidos
 * no servidor, segue para o resumo do carrinho e depois pagamento. Mantido por compat de imports.
 */
export function shouldHoldAwaitingAddressUi(
    _draft: OrderDraft | null,
    _deliveryAddressUiConfirmed: boolean | undefined
): boolean {
    return false;
}

/** Endereço completo no draft ⇒ tratado como confirmado (match interno). */
export function isDeliveryAddressAutoConfirmed(draft: OrderDraft | null): boolean {
    if (isPickupDraft(draft)) return true;
    return isAddressStructurallyComplete(draft?.address ?? null);
}

/** Chamado só com endereço já estruturalmente completo e sem pagamento efetivo. */
function resolveStepWhenPaymentMissing(
    step: ProStep,
    opts?: { hasPendingProductClarify?: boolean; cartReviewAcknowledged?: boolean }
): ProStep {
    /** Ainda há UN/CX para escolher — não avance para resumo/pagamento. */
    if (opts?.hasPendingProductClarify) return "pro_collecting_order";
    if (!opts?.cartReviewAcknowledged) return "pro_awaiting_cart_review";
    if (step === "pro_awaiting_payment_method") return "pro_awaiting_payment_method";
    return "pro_awaiting_payment_method";
}

/**
 * Sincroniza `ProStep` com o rascunho canónico (fonte: draft persistido + tools).
 *
 * Ordem: endereço → resumo (`pro_awaiting_cart_review`) → pagamento → troco →
 * persistência (pagamento é o commit; `pro_awaiting_confirmation` só high-value / legado).
 *
 * Pagamento no draft é ignorado até `cartReviewAcknowledged` — a IA não pula o resumo.
 *
 * Sessão já em `pro_awaiting_confirmation` com draft completo+pagamento: mantém
 * (cliente a meio do fluxo antigo ou high-value).
 */
export function resolveProStepFromDraft(params: {
    step: ProStep;
    draft: OrderDraft | null;
    deliveryAddressUiConfirmed?: boolean;
    /** Clarificação UN/CX ainda na tela (lastSearchPicks ou fila bootstrap). */
    hasPendingProductClarify?: boolean;
    cartReviewAcknowledged?: boolean;
}): ProStep {
    const { step, draft, hasPendingProductClarify } = params;
    const cartReviewAcknowledged = params.cartReviewAcknowledged === true;

    if (step === "handover") return "handover";
    if (step === "pro_awaiting_phone") return "pro_awaiting_phone";
    if (step === "pro_escalation_choice") {
        if (!draft || draft.items.length === 0) return "pro_escalation_choice";
    }
    if (step === "pro_awaiting_change_amount") return "pro_awaiting_change_amount";

    if (!draft || draft.items.length === 0) {
        return step === "pro_idle" ? "pro_idle" : "pro_collecting_order";
    }

    /** Sem modo explícito: não pular pra resumo/pagamento só porque já tem endereço. */
    if (!isPickupDraft(draft) && draft.fulfillmentType !== "delivery") {
        return "pro_collecting_order";
    }

    if (!isPickupDraft(draft) && !isAddressStructurallyComplete(draft.address)) {
        return "pro_collecting_order";
    }

    /**
     * Pedido mínimo de entrega não atingido: não avança pra resumo/pagamento/troco —
     * o cliente ainda precisa poder adicionar itens livremente (texto solto não pode ser
     * barrado pelo gate estrito de pagamento, que só age em `pro_awaiting_payment_method`).
     */
    if (isDraftBelowMinimumOrder(draft)) {
        return "pro_collecting_order";
    }

    /**
     * Fluxo legado / high-value: já está no passo de persistir com pagamento no draft.
     * Não empurrar de volta ao resumo.
     */
    if (step === "pro_awaiting_confirmation" && isDraftStructurallyCompleteForFinalize(draft)) {
        return "pro_awaiting_confirmation";
    }

    const payment = effectiveCheckoutPaymentMethod(draft, cartReviewAcknowledged);

    if (!payment) {
        if (
            params.deliveryAddressUiConfirmed === false &&
            !isPickupDraft(draft) &&
            isAddressStructurallyComplete(draft.address)
        ) {
            return "pro_awaiting_address_confirmation";
        }
        return resolveStepWhenPaymentMissing(step, {
            hasPendingProductClarify,
            cartReviewAcknowledged,
        });
    }

    if (payment === "cash" && draft.changeFor == null) {
        return "pro_awaiting_change_amount";
    }

    if (isDraftStructurallyCompleteForFinalize(draft) && cartReviewAcknowledged) {
        return "pro_awaiting_confirmation";
    }

    return "pro_collecting_order";
}

/** Aplica `resolveProStepFromDraft` ao estado (uso após quick actions / checkout). */
export function withResolvedSlotStep(state: ProSessionState): ProSessionState {
    const awaitingAddressOffer = (state.pendingAddressPickOptions?.length ?? 0) > 0
        || Boolean(state.proposedAddressId);
    const deliveryAddressUiConfirmed = awaitingAddressOffer
        ? state.deliveryAddressUiConfirmed === true
        : isDeliveryAddressAutoConfirmed(state.draft) || state.deliveryAddressUiConfirmed === true;
    const withReview = withCartReviewValidity({
        ...state,
        deliveryAddressUiConfirmed,
    });
    if (withReview.checkoutEditHold) {
        return {
            ...withReview,
            step: "pro_collecting_order",
        };
    }
    const hasPendingProductClarify =
        (withReview.pendingPickGroups?.length ?? 0) > 0 ||
        listLinesByStatus(withReview.orderWorklist, "ambiguous").length > 0 ||
        (withReview.lastSearchPicks?.length ?? 0) >= 2 ||
        (withReview.bootstrapPendingClarifications?.length ?? 0) > 0 ||
        listLinesByStatus(withReview.orderWorklist, "not_found").length > 0;
    return {
        ...withReview,
        step: resolveProStepFromDraft({
            step: withReview.step,
            draft: withReview.draft,
            deliveryAddressUiConfirmed,
            hasPendingProductClarify,
            cartReviewAcknowledged: withReview.cartReviewAcknowledged === true,
        }),
    };
}

/**
 * Igual a `withResolvedSlotStep`, mas não altera o passo quando já estamos em
 * `pro_awaiting_confirmation`: o `orderStage` deve tratar gates (rascunho vazio/incompleto)
 * sem o slot machine “descer” o passo antes da hora.
 */
export function withResolvedSlotStepUnlessAwaitingConfirmation(state: ProSessionState): ProSessionState {
    if (state.step === "pro_awaiting_confirmation") {
        return state;
    }
    return withResolvedSlotStep(state);
}
