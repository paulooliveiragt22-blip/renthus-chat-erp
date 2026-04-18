import type { OutboundMessage, OrderDraft, ProSessionState } from "@/src/types/contracts";
import {
    isAddressStructurallyComplete,
    resolveProStepFromDraft,
    shouldHoldAwaitingAddressUi,
    withResolvedSlotStep,
} from "../orderSlotStep";

export interface QuickActionResult {
    handled: boolean;
    actionTag: string | null;
    state: ProSessionState;
    outbound: OutboundMessage[];
}

/** Quando definido, o botão «Alterar» endereço também oferece o Flow Meta de cadastro. */
export type FlowAddressRegisterQuickOpts = {
    flowId: string;
    threadId: string;
    companyId: string;
};

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

/** Endereço salvo em `enderecos_cliente` ou digitado: confirmar; salvo também permite cadastrar outro via flow. */
function buildAddressConfirmationMessage(draft: OrderDraft): OutboundMessage[] {
    if (!isAddressStructurallyComplete(draft.address)) return [];
    const addr = formatDraftAddressLine(draft);
    const confirmId = draft.address?.enderecoClienteId
        ? "pro_confirm_saved_address"
        : "pro_confirm_typed_address";
    const buttons = draft.address?.enderecoClienteId
        ? [
              { id: confirmId, title: "Confirmar" },
              { id: "pro_new_address_flow", title: "Novo endereco" },
          ]
        : [
              { id: confirmId, title: "Confirmar" },
              { id: "pro_edit_delivery_address", title: "Alterar" },
          ];
    return [
        {
            kind: "buttons",
            text: `Confirma a entrega neste endereco?\n\n${addr}`,
            buttons,
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
    const addrOk =
        state.draft.items.length > 0 && isAddressStructurallyComplete(state.draft.address);
    const addrUiPending = addrOk && state.deliveryAddressUiConfirmed !== true;
    if (
        addrUiPending &&
        (state.step === "pro_awaiting_address_confirmation" || state.step === "pro_collecting_order")
    ) {
        return [];
    }
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
        /** Itens no rascunho mas endereco ainda incompleto: não mostrar pagamento até cadastro/texto. */
        if (
            state.step === "pro_collecting_order" &&
            state.draft.items.length > 0 &&
            !isAddressStructurallyComplete(state.draft.address)
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

const PAYMENT_BUTTON_IDS = new Set(["pro_pay_pix", "pro_pay_card", "pro_pay_cash"]);

const PAYMENT_WORD_ONLY_RE = /^(pix|cartao|dinheiro|especie|card|cash|credito|debito)$/u;

/**
 * Checkout estruturado: (1) em pagamento só botões; (2) antes disso, pagamento por texto/botão
 * só depois de confirmar endereço no servidor.
 */
export function strictCheckoutStructuredGate(text: string, state: ProSessionState): QuickActionResult | null {
    const action = normalizeInboundAction(text);
    const d = state.draft;

    if (state.step === "pro_awaiting_payment_method" && d) {
        if (!action) return null;
        if (isCancelOrderPlainText(text)) return null;
        if (PAYMENT_BUTTON_IDS.has(action)) return null;
        return {
            handled: true,
            actionTag: "strict_payment_inbound_gate",
            state,
            outbound: prioritizeInteractiveFirst([
                {
                    kind: "text",
                    text: "Use um dos botoes abaixo para escolher o pagamento.",
                },
                buildPaymentButtons(),
            ]),
        };
    }

    const payTextOnly = PAYMENT_WORD_ONLY_RE.test(action) && !PAYMENT_BUTTON_IDS.has(action);
    const paymentAttempt = payTextOnly || PAYMENT_BUTTON_IDS.has(action);
    if (
        d &&
        d.items.length > 0 &&
        isAddressStructurallyComplete(d.address) &&
        action &&
        !isCancelOrderPlainText(text)
    ) {
        const addrUiPending = state.deliveryAddressUiConfirmed !== true;
        const blockUntilAddrUi =
            addrUiPending &&
            paymentAttempt &&
            (state.step === "pro_collecting_order" || state.step === "pro_awaiting_address_confirmation");
        const blockPaymentWithoutMethod =
            !d.paymentMethod &&
            paymentAttempt &&
            (state.step === "pro_collecting_order" || state.step === "pro_awaiting_address_confirmation");

        if (blockUntilAddrUi || blockPaymentWithoutMethod) {
            const addrMsg = buildAddressConfirmationMessage(d);
            if (addrMsg.length === 0) return null;
            const hint =
                addrUiPending && d.paymentMethod
                    ? "Confirme o endereco com o botao antes de alterar o pagamento."
                    : "Confirme o endereco com o botao antes de escolher o pagamento.";
            return {
                handled: true,
                actionTag: "strict_address_before_payment",
                state,
                outbound: prioritizeInteractiveFirst([
                    {
                        kind: "text",
                        text: hint,
                    },
                    ...addrMsg,
                ]),
            };
        }
    }

    return null;
}

const ORPHAN_FINAL_CONFIRM_IDS = new Set(["pro_confirm_order", "btn_confirm_order", "btn_confirmar"]);

export function applyQuickAction(
    text: string,
    state: ProSessionState,
    opts?: { flowAddressRegister?: FlowAddressRegisterQuickOpts | null }
): QuickActionResult {
    const action = normalizeInboundAction(text);
    if (!action) return { handled: false, actionTag: null, state, outbound: [] };

    /**
     * Botão "Confirmar" atrasado (WhatsApp) ou reenvio após `draft` limpo: não mandar para IA
     * (vira alucinação + `stripHallucinatedOrderPersistenceClaims`).
     * Em `pro_awaiting_confirmation` sem draft, deixa o `orderStage` responder com gate.
     */
    if (
        ORPHAN_FINAL_CONFIRM_IDS.has(action) &&
        !state.draft &&
        state.step !== "pro_awaiting_confirmation"
    ) {
        return {
            handled: true,
            actionTag: action,
            state,
            outbound: [
                {
                    kind: "text",
                    text: "Esse passo ja foi concluido ou nao ha pedido aberto para confirmar. Para novo pedido, envie os itens.",
                },
            ],
        };
    }

    if (isCancelOrderPlainText(text)) {
        const nextState: ProSessionState = {
            ...state,
            step: "pro_idle",
            draft: null,
            misunderstandingStreak: 0,
            escalationTier: 0,
            searchProdutoEmbalagemIds: [],
            deliveryAddressUiConfirmed: false,
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
            searchProdutoEmbalagemIds: [],
            deliveryAddressUiConfirmed: false,
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

    if (
        (action === "pro_confirm_saved_address" || action === "pro_confirm_typed_address") &&
        state.draft?.address
    ) {
        const merged: ProSessionState = { ...state, deliveryAddressUiConfirmed: true };
        return {
            handled: true,
            actionTag: action,
            state: withResolvedSlotStep(merged),
            outbound: [{ kind: "text", text: "Endereco confirmado." }],
        };
    }

    if ((action === "pro_edit_delivery_address" || action === "pro_new_address_flow") && state.draft) {
        const merged: ProSessionState = {
            ...state,
            deliveryAddressUiConfirmed: false,
            draft: {
                ...state.draft,
                address: null,
                deliveryAddressText: null,
                addressResolutionNote: null,
                pendingConfirmation: false,
            },
        };
        const fr = opts?.flowAddressRegister;
        /** Só o card de flow: sem bolha de texto extra — o cliente toca no CTA do flow para abrir (limite da API Meta). */
        if (fr?.flowId) {
            return {
                handled: true,
                actionTag: action,
                state: withResolvedSlotStep(merged),
                outbound: [
                    {
                        kind: "flow",
                        flow: {
                            flowId:    fr.flowId,
                            flowToken: `${fr.threadId}|${fr.companyId}|address_register`,
                            bodyText:
                                "Toque no botao abaixo para abrir o cadastro de endereco (CEP opcional). " +
                                "Se preferir, pode enviar o endereco em texto: rua, numero, bairro, cidade e UF. " +
                                "Ex.: Rua Tangara, 850, Sao Mateus, Sorriso-MT.",
                            ctaLabel: "Abrir cadastro",
                        },
                    },
                ],
            };
        }
        return {
            handled: true,
            actionTag: action,
            state: withResolvedSlotStep(merged),
            outbound: [
                {
                    kind: "text",
                    text: "Informe o novo endereco: rua, numero, bairro e cidade (todos obrigatorios). Exemplo: Rua Tangara, 850, Sao Mateus, Sorriso-MT.",
                },
            ],
        };
    }

    return { handled: false, actionTag: null, state, outbound: [] };
}

export function checkoutPostProcess(params: {
    state: ProSessionState;
    outbound: OutboundMessage[];
    mode: "direct_reply" | "ai";
    /** Flow Meta cadastro de endereco (apos carrinho com itens). */
    flowAddressRegister?: FlowAddressRegisterQuickOpts | null;
    /** Resultado de `buildOrderHintsPayload` quando o checkout precisa decidir cadastro. */
    orderHints?: Record<string, unknown> | null;
}): { state: ProSessionState; outbound: OutboundMessage[] } {
    let nextState = params.state;
    const outbound = [...params.outbound];

    const addrComplete =
        Boolean(nextState.draft?.address) && isAddressStructurallyComplete(nextState.draft!.address);
    const needAddrRegistration = params.orderHints?.requires_address_flow_registration === true;
    const showAddressRegistrationPrompt =
        params.mode === "ai" &&
        Boolean(params.flowAddressRegister?.flowId) &&
        needAddrRegistration &&
        nextState.draft &&
        nextState.draft.items.length > 0 &&
        !addrComplete &&
        nextState.deliveryAddressUiConfirmed !== true;
    if (showAddressRegistrationPrompt && params.flowAddressRegister) {
        const ref = params.flowAddressRegister;
        outbound.push(
            {
                kind: "text",
                text:
                    "Seu pedido ja tem produtos. Para entregar, cadastre o endereco completo (rua, numero, bairro, cidade e UF). " +
                    "O CEP e opcional e ajuda a preencher automaticamente. Use o formulario abaixo ou descreva tudo em uma mensagem.",
            },
            {
                kind: "flow",
                flow: {
                    flowId:    ref.flowId,
                    flowToken: `${ref.threadId}|${ref.companyId}|address_register`,
                    bodyText:
                        "Abra o formulario para cadastrar o endereco de entrega. Voce tambem pode enviar o endereco em texto no chat.",
                    ctaLabel: "Abrir cadastro",
                },
            }
        );
    }
    const showAddressConfirm =
        params.mode === "ai" &&
        nextState.draft &&
        nextState.draft.items.length > 0 &&
        addrComplete &&
        nextState.deliveryAddressUiConfirmed !== true &&
        (!nextState.draft.paymentMethod ||
            shouldHoldAwaitingAddressUi(nextState.draft, nextState.deliveryAddressUiConfirmed));
    if (showAddressConfirm && nextState.draft) {
        outbound.push(...buildAddressConfirmationMessage(nextState.draft));
    }

    nextState = {
        ...nextState,
        step: resolveProStepFromDraft({
            step: nextState.step,
            draft: nextState.draft,
            deliveryAddressUiConfirmed: nextState.deliveryAddressUiConfirmed,
        }),
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
