import type { OutboundMessage, OrderDraft, ProSessionState } from "@/src/types/contracts";
import { isDraftStructurallyCompleteForFinalize } from "../orderDraftGate";

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
        text: "Escolha a proxima acao:",
        buttons: [
            { id: "pro_edit_order", title: "Editar" },
            { id: "pro_cancel_order", title: "Cancelar" },
            { id: "pro_confirm_order", title: "Confirmar" },
        ],
    };
}

function buildAddressConfirmationMessage(draft: OrderDraft): OutboundMessage[] {
    if (!draft.address?.enderecoClienteId) return [];
    const addr = [
        draft.address.logradouro,
        draft.address.numero,
        draft.address.complemento,
        draft.address.bairroLabel ?? draft.address.bairro,
        draft.address.cidade,
        draft.address.estado,
        draft.address.cep,
    ]
        .filter(Boolean)
        .join(", ");
    return [
        { kind: "text", text: `Endereco de entrega e este?\n${addr}\n\nSe nao for, digite o novo endereco.` },
        {
            kind: "buttons",
            text: "Confirma o endereco salvo?",
            buttons: [{ id: "pro_confirm_saved_address", title: "Confirmar endereco" }],
        },
    ];
}

function checkoutButtonsForState(state: ProSessionState): OutboundMessage[] {
    if (!state.draft) return [];
    if (!state.draft.paymentMethod) return [buildPaymentButtons()];
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

export function applyQuickAction(text: string, state: ProSessionState): QuickActionResult {
    const action = normalizeInboundAction(text);
    if (!action) return { handled: false, actionTag: null, state, outbound: [] };

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
            state: { ...state, step: "pro_collecting_order" },
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

    if (params.mode === "ai" && nextState.draft && nextState.step === "pro_collecting_order" && !nextState.draft.paymentMethod) {
        outbound.push(...buildAddressConfirmationMessage(nextState.draft));
    }
    if (params.mode === "ai" && nextState.draft && isDraftStructurallyCompleteForFinalize(nextState.draft)) {
        nextState = { ...nextState, step: "pro_awaiting_confirmation" };
    }
    outbound.push(...checkoutButtonsForState(nextState));

    return { state: nextState, outbound };
}

export function checkoutPostProcessForQuickAction(params: {
    state: ProSessionState;
    outbound: OutboundMessage[];
}): OutboundMessage[] {
    return [...params.outbound, ...checkoutButtonsForState(params.state)];
}
