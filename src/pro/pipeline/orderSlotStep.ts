import type { DraftAddress, OrderDraft, ProSessionState, ProStep } from "@/src/types/contracts";
import { isDraftBelowMinimumOrder, isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";

/** Endereço mínimo para entrega (rua, número, bairro, cidade, UF — colunas em `enderecos_cliente`). */
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

/**
 * @deprecated Hold de endereço na UI removido: com rua+número+bairro(+cidade/UF) resolvidos
 * no servidor, segue direto para pagamento / resumo final. Mantido por compat de imports.
 */
export function shouldHoldAwaitingAddressUi(
    _draft: OrderDraft | null,
    _deliveryAddressUiConfirmed: boolean | undefined
): boolean {
    return false;
}

/** Endereço completo no draft ⇒ tratado como confirmado (match interno). */
export function isDeliveryAddressAutoConfirmed(draft: OrderDraft | null): boolean {
    return isAddressStructurallyComplete(draft?.address ?? null);
}

/** Chamado só com endereço já estruturalmente completo e sem `paymentMethod`. */
function resolveStepWhenPaymentMissing(
    step: ProStep,
    opts?: { hasPendingProductClarify?: boolean }
): ProStep {
    /** Ainda há UN/CX para escolher — não avance para pagamento. */
    if (opts?.hasPendingProductClarify) return "pro_collecting_order";
    if (step === "pro_awaiting_payment_method") return "pro_awaiting_payment_method";
    /** Endereço já batido no servidor — não pedir "Confirma este endereço?". */
    return "pro_awaiting_payment_method";
}

/**
 * Sincroniza `ProStep` com o rascunho canónico (fonte: draft persistido + tools).
 * Usa `pro_awaiting_address_confirmation` e `pro_awaiting_payment_method` já declarados em `ProStep`.
 *
 * Regra especial: se o cliente já passou para escolha de pagamento (`pro_awaiting_payment_method`)
 * após confirmar endereço salvo, não regressar para confirmação de endereço só porque o draft
 * ainda carrega `enderecoClienteId`.
 *
 * Confirmação final (`pro_awaiting_confirmation`): basta o draft estruturalmente completo
 * (`isDraftStructurallyCompleteForFinalize`); `pendingConfirmation` na tool é opcional.
 */
export function resolveProStepFromDraft(params: {
    step: ProStep;
    draft: OrderDraft | null;
    deliveryAddressUiConfirmed?: boolean;
    /** Clarificação UN/CX ainda na tela (lastSearchPicks ou fila bootstrap). */
    hasPendingProductClarify?: boolean;
}): ProStep {
    const { step, draft, hasPendingProductClarify } = params;

    if (step === "handover") return "handover";
    if (step === "pro_awaiting_phone") return "pro_awaiting_phone";
    if (step === "pro_escalation_choice") {
        if (!draft || draft.items.length === 0) return "pro_escalation_choice";
    }
    if (step === "pro_awaiting_change_amount") return "pro_awaiting_change_amount";

    if (!draft || draft.items.length === 0) {
        return step === "pro_idle" ? "pro_idle" : "pro_collecting_order";
    }

    if (!isAddressStructurallyComplete(draft.address)) {
        return "pro_collecting_order";
    }

    /**
     * Pedido mínimo de entrega não atingido: não avança pra pagamento/troco/confirmação —
     * o cliente ainda precisa poder adicionar itens livremente (texto solto não pode ser
     * barrado pelo gate estrito de pagamento, que só age em `pro_awaiting_payment_method`).
     */
    if (isDraftBelowMinimumOrder(draft)) {
        return "pro_collecting_order";
    }

    if (!draft.paymentMethod) {
        return resolveStepWhenPaymentMissing(step, { hasPendingProductClarify });
    }

    if (draft.paymentMethod === "cash" && draft.changeFor == null) {
        return "pro_awaiting_change_amount";
    }

    if (isDraftStructurallyCompleteForFinalize(draft)) {
        return "pro_awaiting_confirmation";
    }

    return "pro_collecting_order";
}

/** Aplica `resolveProStepFromDraft` ao estado (uso após quick actions / checkout). */
export function withResolvedSlotStep(state: ProSessionState): ProSessionState {
    const deliveryAddressUiConfirmed =
        isDeliveryAddressAutoConfirmed(state.draft) || state.deliveryAddressUiConfirmed === true;
    if (state.checkoutEditHold) {
        return {
            ...state,
            deliveryAddressUiConfirmed,
            step: "pro_collecting_order",
        };
    }
    const hasPendingProductClarify =
        (state.lastSearchPicks?.length ?? 0) >= 2 ||
        (state.bootstrapPendingClarifications?.length ?? 0) > 0 ||
        (state.pendingAskRepeatTerms?.length ?? 0) > 0;
    return {
        ...state,
        deliveryAddressUiConfirmed,
        step: resolveProStepFromDraft({
            step: state.step,
            draft: state.draft,
            deliveryAddressUiConfirmed,
            hasPendingProductClarify,
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
