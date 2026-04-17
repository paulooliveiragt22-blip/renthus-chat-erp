import type { OutboundMessage, OrderDraft, ProSessionState } from "@/src/types/contracts";
import { isAddressStructurallyComplete, resolveProStepFromDraft } from "../orderSlotStep";

export interface QuickActionResult {
    handled: boolean;
    actionTag: string | null;
    state: ProSessionState;
    outbound: OutboundMessage[];
}

function normalizeInboundAction(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "");
}

function parsePtMoneyInput(text: string): number | null {
    const only = text.replaceAll(/[^\d,.\s]/g, "").trim();
    if (!only) return null;
    const normalized = only
        .replaceAll(/\s+/g, "")
        .replaceAll(".", "")
        .replace(",", ".");
    const value = Number(normalized);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100) / 100;
}

function buildPaymentButtons(): OutboundMessage {
    return {
        kind: "buttons",
        text: "Escolha a forma de pagamento:",
        buttons: [
            { id: "pro_pay_pix", title: "PIX" },
            { id: "pro_pay_card", title: "Cartao" },
            { id: "pro_pay_cash", title: "Dinheiro" },
        ],
    };
}

function buildConfirmationActionButtons(): OutboundMessage {
    return {
        kind: "buttons",
        text: "Revise o resumo acima e escolha uma opcao:",
        buttons: [
            { id: "pro_confirm_order", title: "Confirmar" },
            { id: "pro_edit_order", title: "Corrigir" },
            { id: "pro_add_items", title: "Adicionar produtos" },
        ],
    };
}

function formatDraftAddressLine(draft: OrderDraft): string {
    const a = draft.address;
    if (!a) return "";
    return [
        a.logradouro,
        a.numero,
        a.complemento,
        a.bairroLabel ?? a.bairro,
        a.cidade,
        a.estado,
        a.cep,
    ]
        .filter(Boolean)
        .join(", ");
}

/** Endereço salvo em `enderecos_cliente` ou digitado (sem id): sempre com botão Confirmar antes do pagamento. */
function buildAddressConfirmationMessage(draft: OrderDraft): OutboundMessage[] {
    if (!isAddressStructurallyComplete(draft.address)) return [];
    const addr = formatDraftAddressLine(draft);
    if (draft.address?.enderecoClienteId) {
        return [
            {
                kind: "buttons",
                text:
                    `O endereco de entrega e este?\n${addr}\n\nSe nao for, digite o endereco completo.`,
                buttons: [{ id: "pro_confirm_saved_address", title: "Confirmar endereco" }],
            },
        ];
    }
    return [
        {
            kind: "buttons",
            text:
                `O endereco de entrega e este?\n${addr}\n\nSe nao for, digite o endereco completo.`,
            buttons: [{ id: "pro_confirm_typed_address", title: "Confirmar endereco" }],
        },
    ];
}

/** WhatsApp: mensagens interactivas primeiro, depois texto (melhor UX e alinhado a “botão primeiro”). */
export function prioritizeInteractiveFirst(messages: OutboundMessage[]): OutboundMessage[] {
    const interactive = messages.filter((m) => m.kind === "buttons" || m.kind === "flow");
    const plain = messages.filter((m) => m.kind === "text");
    return [...interactive, ...plain];
}

function checkoutButtonsForState(state: ProSessionState): OutboundMessage[] {
    if (!state.draft) return [];
    if (!state.draft.paymentMethod) {
        /** Aguardando confirmação de endereço (salvo ou digitado): não mostrar pagamento ainda. */
        if (
            state.step === "pro_awaiting_address_confirmation" ||
            (state.step === "pro_collecting_order" &&
                state.draft.items.length > 0 &&
                isAddressStructurallyComplete(state.draft.address))
        ) {
            return [];
        }
        return [buildPaymentButtons()];
    }
    if (state.step === "pro_awaiting_confirmation") return [buildConfirmationActionButtons()];
    return [];
}

function resolvePaymentQuickAction(action: string, state: ProSessionState): QuickActionResult | null {
    if (!state.draft) return null;
    if (action === "pro_pay_pix") {
        return {
            handled: true,
            actionTag: action,
            state: {
                ...state,
                step: "pro_collecting_order",
                draft: { ...state.draft, paymentMethod: "pix", changeFor: null },
            },
            outbound: [{ kind: "text", text: "Pagamento em PIX selecionado." }],
        };
    }
    if (action === "pro_pay_card") {
        return {
            handled: true,
            actionTag: action,
            state: {
                ...state,
                step: "pro_collecting_order",
                draft: { ...state.draft, paymentMethod: "card", changeFor: null },
            },
            outbound: [{ kind: "text", text: "Pagamento em cartao selecionado." }],
        };
    }
    if (action === "pro_pay_cash") {
        return {
            handled: true,
            actionTag: action,
            state: {
                ...state,
                step: "pro_awaiting_change_amount",
                draft: { ...state.draft, paymentMethod: "cash" },
            },
            outbound: [{ kind: "text", text: "Pagamento em dinheiro. Troco pra quanto?" }],
        };
    }
    return null;
}

const CANCEL_TEXT_ACTIONS = new Set(["cancelar", "cancela", "desistir", "desisto"]);

function isCancelOrderPlainText(text: string): boolean {
    const action = normalizeInboundAction(text).replaceAll(/\s+/g, " ").trim();
    if (CANCEL_TEXT_ACTIONS.has(action)) return true;
    return /^(?:cancelar|cancela|desistir|desisto)\b/u.test(action);
}

export function applyQuickAction(text: string, state: ProSessionState): QuickActionResult {
    const action = normalizeInboundAction(text);
    if (!action) return { handled: false, actionTag: null, state, outbound: [] };

    if (isCancelOrderPlainText(text)) {
        const nextState: ProSessionState = {
            ...state,
            step: "pro_idle",
            draft: null,
            misunderstandingStreak: 0,
            escalationTier: 0,
        };
        return {
            handled: true,
            actionTag: "cancelar_texto",
            state: nextState,
            outbound: [{ kind: "text", text: "Pedido cancelado. Quando quiser, me diga o que precisa." }],
        };
    }

    if (action === "pro_cancel_order" || action === "btn_cancel_order") {
        const nextState: ProSessionState = {
            ...state,
            step: "pro_idle",
            draft: null,
            misunderstandingStreak: 0,
            escalationTier: 0,
        };
        return {
            handled: true,
            actionTag: action,
            state: nextState,
            outbound: [{ kind: "text", text: "Pedido cancelado. Quando quiser, me diga o que precisa." }],
        };
    }

    if (action === "pro_edit_order" || action === "btn_edit_order") {
        return {
            handled: true,
            actionTag: action,
            state: { ...state, step: "pro_collecting_order" },
            outbound: [{ kind: "text", text: "Perfeito. Me diga o que voce quer editar no pedido." }],
        };
    }

    if (action === "pro_add_items" || action === "btn_add_items") {
        return {
            handled: true,
            actionTag: action,
            state: { ...state, step: "pro_collecting_order" },
            outbound: [{ kind: "text", text: "Certo. Me diga os produtos que quer adicionar." }],
        };
    }

    const paymentAction = resolvePaymentQuickAction(action, state);
    if (paymentAction) return paymentAction;

    if (state.step === "pro_awaiting_change_amount" && state.draft?.paymentMethod === "cash") {
        const amount = parsePtMoneyInput(text);
        if (amount != null) {
            return {
                handled: true,
                actionTag: "pro_cash_change_value",
                state: {
                    ...state,
                    step: "pro_collecting_order",
                    draft: { ...state.draft, changeFor: amount },
                },
                outbound: [{ kind: "text", text: `Troco registrado para R$ ${amount.toFixed(2).replace(".", ",")}.` }],
            };
        }
        return {
            handled: true,
            actionTag: "pro_cash_change_invalid",
            state,
            outbound: [{ kind: "text", text: "Nao entendi o valor do troco. Exemplo: 100,00." }],
        };
    }

    if (action === "pro_confirm_saved_address" && state.draft?.address) {
        return {
            handled: true,
            actionTag: action,
            state: { ...state, step: "pro_awaiting_payment_method" },
            outbound: [{ kind: "text", text: "Endereco confirmado." }],
        };
    }

    if (action === "pro_confirm_typed_address" && state.draft?.address) {
        return {
            handled: true,
            actionTag: action,
            state: { ...state, step: "pro_awaiting_payment_method" },
            outbound: [{ kind: "text", text: "Endereco confirmado." }],
        };
    }

    return { handled: false, actionTag: null, state, outbound: [] };
}

export function checkoutPostProcess(params: {
    state: ProSessionState;
    outbound: OutboundMessage[];
    mode: "direct_reply" | "ai";
}): { state: ProSessionState; outbound: OutboundMessage[] } {
    let nextState = params.state;
    const outbound = [...params.outbound];

    const addrComplete =
        Boolean(nextState.draft?.address) && isAddressStructurallyComplete(nextState.draft!.address);
    const showAddressConfirm =
        params.mode === "ai" &&
        nextState.draft &&
        nextState.draft.items.length > 0 &&
        !nextState.draft.paymentMethod &&
        addrComplete &&
        (nextState.step === "pro_collecting_order" ||
            nextState.step === "pro_awaiting_address_confirmation");
    if (showAddressConfirm && nextState.draft) {
        outbound.push(...buildAddressConfirmationMessage(nextState.draft));
    }

    nextState = {
        ...nextState,
        step: resolveProStepFromDraft({ step: nextState.step, draft: nextState.draft }),
    };
    outbound.push(...checkoutButtonsForState(nextState));

    return { state: nextState, outbound: prioritizeInteractiveFirst(outbound) };
}

export function checkoutPostProcessForQuickAction(params: {
    state: ProSessionState;
    outbound: OutboundMessage[];
}): OutboundMessage[] {
    return prioritizeInteractiveFirst([...params.outbound, ...checkoutButtonsForState(params.state)]);
}
