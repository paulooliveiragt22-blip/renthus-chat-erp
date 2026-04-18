import type { DraftAddress, OrderDraft, ProSessionState, ProStep } from "@/src/types/contracts";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";

/** Endereço mínimo para entrega (rua, número, bairro, cidade — colunas em `enderecos_cliente`). */
export function isAddressStructurallyComplete(address: DraftAddress | null): boolean {
    if (!address) return false;
    return Boolean(
        address.logradouro?.trim() &&
            address.numero?.trim() &&
            address.bairro?.trim() &&
            address.cidade?.trim()
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
 * Draft já tem itens, endereço mínimo, pagamento e troco (se dinheiro), mas o cliente ainda não
 * confirmou o endereço na UI — não avançar para `pro_awaiting_confirmation`.
 */
export function shouldHoldAwaitingAddressUi(
    draft: OrderDraft | null,
    deliveryAddressUiConfirmed: boolean | undefined
): boolean {
    if (draft == null || draft.items.length === 0) return false;
    if (!isAddressStructurallyComplete(draft.address)) return false;
    if (!draft.paymentMethod) return false;
    if (draft.paymentMethod === "cash" && draft.changeFor == null) return false;
    if (!isDraftStructurallyCompleteForFinalize(draft)) return false;
    return deliveryAddressUiConfirmed !== true;
}

/** Chamado só com endereço já estruturalmente completo e sem `paymentMethod`. */
function resolveStepWhenPaymentMissing(step: ProStep): ProStep {
    if (step === "pro_awaiting_payment_method") return "pro_awaiting_payment_method";
    if (step === "pro_awaiting_address_confirmation") return "pro_awaiting_address_confirmation";
    /** Primeira vez com endereço completo (salvo ou digitado): confirmação antes do pagamento. */
    return "pro_awaiting_address_confirmation";
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
}): ProStep {
    const { step, draft, deliveryAddressUiConfirmed } = params;

    if (step === "handover") return "handover";
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

    if (!draft.paymentMethod) {
        if (isAddressStructurallyComplete(draft.address) && deliveryAddressUiConfirmed === true) {
            return "pro_awaiting_payment_method";
        }
        return resolveStepWhenPaymentMissing(step);
    }

    if (draft.paymentMethod === "cash" && draft.changeFor == null) {
        return "pro_awaiting_change_amount";
    }

    if (isDraftStructurallyCompleteForFinalize(draft)) {
        if (shouldHoldAwaitingAddressUi(draft, deliveryAddressUiConfirmed)) {
            return "pro_awaiting_address_confirmation";
        }
        return "pro_awaiting_confirmation";
    }

    return "pro_collecting_order";
}

/** Aplica `resolveProStepFromDraft` ao estado (uso após quick actions / checkout). */
export function withResolvedSlotStep(state: ProSessionState): ProSessionState {
    return {
        ...state,
        step: resolveProStepFromDraft({
            step: state.step,
            draft: state.draft,
            deliveryAddressUiConfirmed: state.deliveryAddressUiConfirmed,
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
