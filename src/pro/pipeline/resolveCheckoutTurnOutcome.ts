/**
 * Outcome estruturado do turno de checkout (pós-modelo / pós-tools).
 * Equivalente a structured output no fim do agent loop: roteamento por estado do draft,
 * sem nova chamada LLM.
 */
import type { ProSessionState } from "@/src/types/contracts";
import { isAddressStructurallyComplete } from "./orderSlotStep";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";

export type CheckoutTurnOutcomeKind =
    | "clarify_pending_picks"
    | "clarify_product_picks"
    | "register_address_flow"
    | "confirm_address"
    | "ask_payment"
    | "ask_change"
    | "confirm_order"
    | "collecting"
    | "empty_search_hint"
    | "none";

export type CheckoutTurnOutcome = {
    kind: CheckoutTurnOutcomeKind;
    /** Step canónico sugerido após alinha draft↔UI. */
    reason: string;
};

/**
 * Decide a próxima UI de checkout a partir do estado (tools_condition / post_model_hook).
 */
export function resolveCheckoutTurnOutcome(params: {
    state: ProSessionState;
    mode: "direct_reply" | "ai";
    showAddressRegistrationPrompt?: boolean;
}): CheckoutTurnOutcome {
    const { state, mode } = params;
    const draft = state.draft;

    if (params.showAddressRegistrationPrompt) {
        return { kind: "register_address_flow", reason: "needs_address_registration" };
    }

    /**
     * Embalagem ambígua de 1+ produtos citados no mesmo turno (`search_produtos` acabou de
     * popular `pendingPickGroups`): pergunta consolidada em texto livre substitui a prosa da
     * IA — nunca card de botões em paralelo (ver `pendingPickGroups.ts`).
     */
    if (
        (state.pendingPickGroups?.length ?? 0) > 0 &&
        (mode === "ai" || state.checkoutEditHold === true) &&
        state.step !== "pro_awaiting_confirmation"
    ) {
        return { kind: "clarify_pending_picks", reason: "pending_pick_groups" };
    }

    if (
        (state.lastSearchPicks?.length ?? 0) >= 2 &&
        (mode === "ai" || state.checkoutEditHold === true) &&
        state.step !== "pro_awaiting_confirmation"
    ) {
        return { kind: "clarify_product_picks", reason: "ambiguous_search_picks" };
    }

    if (mode === "ai" && (state.emptySearchStreak ?? 0) >= 2 && !(draft?.items?.length)) {
        return { kind: "empty_search_hint", reason: "empty_search_streak" };
    }

    if (!draft?.items?.length) {
        return { kind: "none", reason: "no_draft_items" };
    }

    if ((state.bootstrapPendingClarifications?.length ?? 0) > 0) {
        return { kind: "clarify_product_picks", reason: "bootstrap_clarify_queue" };
    }

    const addrOk = isAddressStructurallyComplete(draft.address ?? null);
    if (addrOk && state.deliveryAddressUiConfirmed !== true) {
        return { kind: "confirm_address", reason: "address_needs_ui_confirm" };
    }

    if (addrOk && state.deliveryAddressUiConfirmed === true && !draft.paymentMethod) {
        return { kind: "ask_payment", reason: "awaiting_payment_method" };
    }

    if (
        draft.paymentMethod === "cash" &&
        draft.changeFor == null &&
        state.deliveryAddressUiConfirmed === true
    ) {
        return { kind: "ask_change", reason: "awaiting_change_amount" };
    }

    if (isDraftStructurallyCompleteForFinalize(draft) && state.deliveryAddressUiConfirmed === true) {
        return { kind: "confirm_order", reason: "draft_ready_for_confirm" };
    }

    return { kind: "collecting", reason: "slots_incomplete" };
}
