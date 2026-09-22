/**
 * Inbound de escolha fechada no checkout PRO.
 * Conjunto fechado (dinheiro / estado) = só botão (ID ou título exacto).
 * Dado inventável (itens, endereço livre, troco) = texto + botão.
 */

import {
    isFulfillmentUnavailable,
    needsFulfillmentChoice,
    parseFulfillmentType,
    type FulfillmentPolicy,
    type FulfillmentType,
} from "@/lib/delivery/fulfillment";
import { listLinesByStatus, reconcileWorklistLinesWithDraft } from "@/src/pro/domain/orderWorklist/orderWorklist";
import { worklistCheckoutGate } from "@/src/pro/pipeline/orderWorklist/worklistCheckoutGate";
import { isDraftBelowMinimumOrder, isAddressStructurallyComplete } from "@/src/pro/pipeline/orderDraftGate";
import type { OutboundMessage, ProSessionState } from "@/src/types/contracts";
import { parseAddressOfferIndex } from "./deliveryAddressOffer";
import {
    detectStructuredCheckoutAction,
    looksLikeCheckoutRevisionText,
    looksLikeWeakConfirmProse,
} from "./orderConfirmationText";

/** Mesmo prefixo de `serverPrepareAfterAddressPick` — sem importar o módulo server-only. */
const PICK_ADDRESS_PREFIX = "pro_pick_address:";

export function normalizeCheckoutInbound(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

const FULFILLMENT_BUTTON_IDS = new Set(["pro_fulfillment_delivery", "pro_fulfillment_pickup"]);
const FULFILLMENT_BUTTON_TITLES = new Set(["entrega", "retirar no local"]);

export function isFulfillmentButtonInbound(text: string): boolean {
    const n = normalizeCheckoutInbound(text);
    if (!n) return false;
    return FULFILLMENT_BUTTON_IDS.has(n) || FULFILLMENT_BUTTON_TITLES.has(n);
}

export function fulfillmentTypeFromButtonInbound(text: string): FulfillmentType | null {
    if (!isFulfillmentButtonInbound(text)) return null;
    return parseFulfillmentType(text);
}

const OOS_ADD = new Set(["pro_oos_add_other", "sim"]);
const OOS_CONTINUE = new Set(["pro_oos_continue", "nao"]);

export function isOosAddInbound(text: string): boolean {
    return OOS_ADD.has(normalizeCheckoutInbound(text));
}

export function isOosContinueInbound(text: string): boolean {
    return OOS_CONTINUE.has(normalizeCheckoutInbound(text));
}

export function isOosButtonInbound(text: string): boolean {
    return isOosAddInbound(text) || isOosContinueInbound(text);
}

const CANCEL_TEXT_ACTIONS = new Set(["cancelar", "cancela", "desistir", "desisto"]);

export function isClosedChoiceCancelInbound(text: string): boolean {
    const n = normalizeCheckoutInbound(text);
    if (!n) return false;
    if (detectStructuredCheckoutAction(text) === "cancel") return true;
    if (CANCEL_TEXT_ACTIONS.has(n)) return true;
    return /^(?:cancelar|cancela|desistir|desisto)\b/u.test(n);
}

const REVIEW_NAV_IDS = new Set([
    "pro_edit_order",
    "btn_edit_order",
    "pro_add_items",
    "btn_add_items",
]);

const PAYMENT_BUTTON_IDS = new Set([
    "pro_pay_pix",
    "pro_pay_card",
    "pro_pay_debit",
    "pro_pay_cash",
]);

/** Confirmar / Corrigir / Adicionar / cancelar / revisão real / botão de pagamento atrasado. */
export function isCartReviewPassThrough(text: string): boolean {
    const n = normalizeCheckoutInbound(text);
    if (!n) return false;
    if (detectStructuredCheckoutAction(text) != null) return true;
    if (REVIEW_NAV_IDS.has(n)) return true;
    if (PAYMENT_BUTTON_IDS.has(n)) return true;
    if (isClosedChoiceCancelInbound(text)) return true;
    if (looksLikeWeakConfirmProse(text)) return false;
    return looksLikeCheckoutRevisionText(text);
}

export function isFinalConfirmPassThrough(text: string): boolean {
    return isCartReviewPassThrough(text);
}

const ESCALATION_IDS = new Set(["btn_support", "btn_order", "btn_catalog", "btn_status"]);
const ESCALATION_TITLES = new Set(["atendente", "continuar pedido", "falar com atendente"]);

export function isEscalationPassThrough(text: string): boolean {
    const n = normalizeCheckoutInbound(text);
    if (!n) return false;
    if (ESCALATION_IDS.has(n) || ESCALATION_TITLES.has(n)) return true;
    return isClosedChoiceCancelInbound(text);
}

export function isAddressOfferPassThrough(text: string, othersCount: number): boolean {
    const n = normalizeCheckoutInbound(text);
    if (!n) return false;
    if (
        n === "pro_confirm_saved_address" ||
        n === "pro_new_address_flow" ||
        n === "pro_edit_delivery_address" ||
        n === "confirmar" ||
        n === "novo"
    ) {
        return true;
    }
    if (n.startsWith(PICK_ADDRESS_PREFIX)) return true;
    if (parseAddressOfferIndex(text, othersCount) != null) return true;
    return isClosedChoiceCancelInbound(text);
}

export function buildEscalationChoiceButtons(): OutboundMessage {
    return {
        kind: "buttons",
        text: "Como prefere continuar?",
        buttons: [
            { id: "btn_support", title: "Atendente" },
            { id: "btn_order", title: "Continuar pedido" },
        ],
    };
}

export function buildAddressOfferRepeatButtons(): OutboundMessage {
    return {
        kind: "buttons",
        text: "Use os botões ou o número da lista para escolher o endereço.",
        buttons: [
            { id: "pro_confirm_saved_address", title: "Confirmar" },
            { id: "pro_new_address_flow", title: "Novo" },
        ],
    };
}

/** Overlays que impedem Entrega/Retirar / resumo / pagamento (estoque, pick, worklist). */
export function blocksCheckoutStructuredButtons(state: ProSessionState): boolean {
    if (!state.draft) return true;
    if ((state.pendingOutOfStockOffer?.names?.length ?? 0) > 0) return true;
    const stateForGate: ProSessionState = {
        ...state,
        orderWorklist: reconcileWorklistLinesWithDraft(state.orderWorklist, state.draft),
    };
    if (worklistCheckoutGate({ state: stateForGate }).blocked) return true;
    if (listLinesByStatus(stateForGate.orderWorklist, "not_found").length > 0) return true;
    const hasDraftItems = state.draft.items.length > 0;
    const ambiguousPicksOpen =
        (state.pendingPickGroups?.length ?? 0) > 0 ||
        ((state.lastSearchPicks?.length ?? 0) >= 2 && !hasDraftItems);
    if (ambiguousPicksOpen) return true;
    if ((state.bootstrapPendingClarifications?.length ?? 0) > 0) return true;
    return false;
}

export function isClosedFulfillmentChoiceOpen(
    state: ProSessionState,
    policy: FulfillmentPolicy
): boolean {
    if (state.checkoutEditHold) return false;
    if (blocksCheckoutStructuredButtons(state)) return false;
    if (!state.draft?.items.length) return false;
    if (isFulfillmentUnavailable(policy)) return false;
    /** Abaixo do mínimo ainda está coletando itens — texto livre não pode ser barrado. */
    if (isDraftBelowMinimumOrder(state.draft)) return false;
    /**
     * Endereço completo ⇒ entrega implícita (mesmo critério de `applyFulfillmentPolicyToDraft`).
     * Não reabrir o gate Entrega/Retirar nem barrar prosa.
     */
    if (
        policy.deliveriesEnabled &&
        isAddressStructurallyComplete(state.draft.address ?? null)
    ) {
        return false;
    }
    return needsFulfillmentChoice(policy, state.draft.fulfillmentType);
}
