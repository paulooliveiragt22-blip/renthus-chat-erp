/**
 * Outcome estruturado do turno de checkout (pós-modelo / pós-tools).
 * Equivalente a structured output no fim do agent loop: roteamento por estado do draft,
 * sem nova chamada LLM.
 */
import type { ProSessionState } from "@/src/types/contracts";
import { isAddressStructurallyComplete } from "./orderSlotStep";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";
import { isPickupDraft, needsFulfillmentChoice, type FulfillmentPolicy } from "@/lib/delivery/fulfillment";
import { worklistCheckoutGate } from "./orderWorklist/worklistCheckoutGate";
import { listLinesByStatus } from "@/src/pro/domain/orderWorklist/orderWorklist";
import { activeClarifyPickGroups } from "./orderWorklist/syncPendingPickGroupsFromWorklist";

export type CheckoutTurnOutcomeKind =
    | "clarify_pending_picks"
    | "clarify_product_picks"
    | "offer_out_of_stock"
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
    fulfillmentPolicy?: FulfillmentPolicy;
}): CheckoutTurnOutcome {
    const { state, mode } = params;
    const draft = state.draft;

    if ((state.pendingOutOfStockOffer?.names?.length ?? 0) > 0) {
        return { kind: "offer_out_of_stock", reason: "pending_out_of_stock_offer" };
    }

    if (params.showAddressRegistrationPrompt) {
        return { kind: "register_address_flow", reason: "needs_address_registration" };
    }

    /**
     * Embalagem ambígua: group ativo alinhado (ADR 0011 D8 — um por vez).
     */
    const alignedGroups = activeClarifyPickGroups(
        state.orderWorklist,
        state.pendingPickGroups ?? []
    );
    if (
        alignedGroups.length > 0 &&
        (mode === "ai" || state.checkoutEditHold === true) &&
        state.step !== "pro_awaiting_confirmation"
    ) {
        return { kind: "clarify_pending_picks", reason: "pending_pick_groups" };
    }

    if (
        listLinesByStatus(state.orderWorklist, "awaiting_qty").length > 0 &&
        (mode === "ai" || state.checkoutEditHold === true) &&
        state.step !== "pro_awaiting_confirmation"
    ) {
        return { kind: "collecting", reason: "worklist_awaiting_qty" };
    }

    const wlGate = worklistCheckoutGate({ state });
    if (wlGate.blocked && listLinesByStatus(state.orderWorklist, "pending_search").length > 0) {
        return { kind: "collecting", reason: wlGate.reason ?? "worklist_blocks_checkout" };
    }

    /**
     * Picks legados: só se worklist vazia (sem lines). Com worklist, clarify é só via groups.
     */
    const hasWorklistLines = (state.orderWorklist?.lines?.length ?? 0) > 0;
    if (
        !hasWorklistLines &&
        (state.lastSearchPicks?.length ?? 0) >= 2 &&
        !(draft?.items?.length) &&
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

    if (params.fulfillmentPolicy && needsFulfillmentChoice(params.fulfillmentPolicy, draft.fulfillmentType)) {
        return { kind: "collecting", reason: "needs_fulfillment" };
    }

    const addrOk = isPickupDraft(draft) || isAddressStructurallyComplete(draft.address ?? null);
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
