import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderLineExtraction } from "@/src/domain/contracts/orderExtraction";
import type { OutboundMessage, ProSessionState } from "@/src/types/contracts";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";
import { isAddressStructurallyComplete, withResolvedSlotStep } from "./orderSlotStep";
import {
    isAdditiveCatalogQtyOffer,
    resolveSingleOfferedEmbalagemId,
} from "./serverPrepareFromCatalogQtyOffer";
import { serverPrepareAfterProductPick } from "./serverPrepareAfterPick";
import { checkoutPostProcessForQuickAction } from "./stages/checkoutPostProcess";

function buildPaymentButtons(): OutboundMessage {
    return {
        kind: "buttons",
        text: "Escolha a forma de pagamento:",
        buttons: [
            { id: "pro_pay_pix", title: "PIX" },
            { id: "pro_pay_card", title: "Cartão" },
            { id: "pro_pay_cash", title: "Dinheiro" },
        ],
    };
}

export type DialogueExecResult = {
    handled: boolean;
    state: ProSessionState;
    outbound: OutboundMessage[];
    /** Se true, o pipeline deve seguir até orderStage (confirm). */
    deferToOrderStage?: boolean;
    tag?: string;
};

/**
 * Executa atos de diálogo da extração LLM no servidor (prepare / botões / flags).
 * A prosa da IA não fecha contrato — este módulo sim.
 */
export async function tryServerExecuteFromDialogue(params: {
    admin: SupabaseClient;
    companyId: string;
    extraction: OrderLineExtraction | null;
    state: ProSessionState;
}): Promise<DialogueExecResult> {
    const dialogue = params.extraction?.dialogue;
    if (!dialogue?.act) {
        return { handled: false, state: params.state, outbound: [] };
    }

    const { act, quantity } = dialogue;
    let state = params.state;
    const offeredId = resolveSingleOfferedEmbalagemId(state);
    const qty =
        quantity != null && Number.isFinite(Number(quantity)) && Number(quantity) > 0
            ? Math.floor(Number(quantity))
            : null;

    if (act === "decline_add_more") {
        return {
            handled: true,
            tag: "dialogue_decline_add_more",
            state: {
                ...state,
                lastSearchPicks: [],
                checkoutEditHold: false,
            },
            outbound: state.draft?.items?.length
                ? isAddressStructurallyComplete(state.draft.address) && !state.draft.paymentMethod
                    ? [buildPaymentButtons()]
                    : isDraftStructurallyCompleteForFinalize(state.draft)
                      ? checkoutPostProcessForQuickAction({
                            state: withResolvedSlotStep({
                                ...state,
                                lastSearchPicks: [],
                                checkoutEditHold: false,
                            }),
                            outbound: [],
                        })
                      : [
                            {
                                kind: "text",
                                text: "Beleza, mantemos o que já está no pedido. O que falta ajustar?",
                            },
                        ]
                : [{ kind: "text", text: "Ok. Me diga o que você precisa." }],
        };
    }

    if (act === "add_more" && qty == null) {
        if (!offeredId && !(state.draft?.items?.length)) {
            return { handled: false, state, outbound: [] };
        }
        return {
            handled: true,
            tag: "dialogue_add_more_ask_qty",
            state: { ...state, checkoutEditHold: false },
            outbound: [
                {
                    kind: "text",
                    text: "Quantas unidades mais você quer adicionar?",
                },
            ],
        };
    }

    if (
        (act === "quantity_only" || (act === "add_more" && qty != null)) &&
        offeredId &&
        qty != null
    ) {
        const additive = isAdditiveCatalogQtyOffer(state) || act === "add_more";
        const stateForPrep = additive
            ? {
                  ...state,
                  pendingClarifyQuantity: qty,
                  inferredPaymentMethod: null,
                  checkoutEditHold: false,
                  draft: state.draft
                      ? {
                            ...state.draft,
                            paymentMethod: null,
                            changeFor: null,
                        }
                      : null,
              }
            : {
                  ...state,
                  pendingClarifyQuantity: qty,
                  checkoutEditHold: false,
              };

        const serverPrep = await serverPrepareAfterProductPick({
            admin: params.admin,
            companyId: params.companyId,
            customerId: state.customerId,
            state: stateForPrep,
            pickedEmbalagemId: offeredId,
            additiveQuantity: additive,
        });
        state = withResolvedSlotStep({
            ...serverPrep.state,
            checkoutEditHold: false,
        });
        const outbound = checkoutPostProcessForQuickAction({
            state,
            outbound: [],
        });
        return {
            handled: true,
            tag: additive ? "dialogue_add_qty" : "dialogue_quantity_only",
            state,
            outbound:
                outbound.length > 0
                    ? outbound
                    : [
                          {
                              kind: "text",
                              text: "Anotei a quantidade. Escolha a forma de pagamento ou confirme o que falta.",
                          },
                      ],
        };
    }

    if (act === "affirm_slots") {
        if (
            state.draft?.items?.length &&
            isAddressStructurallyComplete(state.draft.address) &&
            !state.draft.paymentMethod
        ) {
            state = withResolvedSlotStep({
                ...state,
                deliveryAddressUiConfirmed: true,
                checkoutEditHold: false,
                inferredPaymentMethod: null,
                lastSearchPicks: [],
            });
            return {
                handled: true,
                tag: "dialogue_affirm_show_payment",
                state,
                outbound: [buildPaymentButtons()],
            };
        }
        if (state.draft && isDraftStructurallyCompleteForFinalize(state.draft)) {
            const next = withResolvedSlotStep({
                ...state,
                checkoutEditHold: false,
                inferredPaymentMethod: null,
                lastSearchPicks: [],
            });
            return {
                handled: true,
                tag: "dialogue_affirm_show_confirm",
                state: next,
                outbound: checkoutPostProcessForQuickAction({
                    state: next,
                    outbound: [],
                }),
            };
        }
        return { handled: false, state, outbound: [] };
    }

    if (act === "confirm_order") {
        if (state.draft && isDraftStructurallyCompleteForFinalize(state.draft)) {
            return {
                handled: false,
                deferToOrderStage: true,
                tag: "dialogue_confirm_order",
                state: withResolvedSlotStep({
                    ...state,
                    checkoutEditHold: false,
                    inferredPaymentMethod: null,
                    lastSearchPicks: [],
                }),
                outbound: [],
            };
        }
        if (
            state.draft?.items?.length &&
            isAddressStructurallyComplete(state.draft.address) &&
            !state.draft.paymentMethod
        ) {
            state = withResolvedSlotStep({
                ...state,
                checkoutEditHold: false,
                inferredPaymentMethod: null,
                lastSearchPicks: [],
            });
            return {
                handled: true,
                tag: "dialogue_confirm_needs_payment",
                state,
                outbound: [buildPaymentButtons()],
            };
        }
        return {
            handled: true,
            tag: "dialogue_confirm_incomplete",
            state: { ...state, checkoutEditHold: false },
            outbound: [
                {
                    kind: "text",
                    text: "Ainda falta fechar itens, endereço ou pagamento antes de confirmar.",
                },
            ],
        };
    }

    return { handled: false, state, outbound: [] };
}
