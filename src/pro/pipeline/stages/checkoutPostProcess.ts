import type { OutboundMessage, OrderDraft, ProSessionState } from "@/src/types/contracts";
import {
    formatCanonicalDraftSummary,
    formatSearchPicksClarificationBody,
} from "../orderDraftPresenter";
import { PICK_EMB_PREFIX } from "../productPickText";
import { buildUniquePickButtons } from "../pickButtonTitles";
import { catalogProductHintFromPicks } from "../catalogProductHint";
import {
    isAddressStructurallyComplete,
    resolveProStepFromDraft,
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

function buildConfirmationActionButtons(draft: OrderDraft): OutboundMessage {
    return {
        kind: "buttons",
        text: formatCanonicalDraftSummary(draft),
        buttons: [
            { id: "pro_confirm_order", title: "Confirmar" },
            { id: "pro_edit_order", title: "Corrigir" },
            { id: "pro_add_items", title: "Adicionar produtos" },
        ],
    };
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
        /** Itens sem endereço completo: não mostrar pagamento. */
        if (
            state.draft.items.length > 0 &&
            !isAddressStructurallyComplete(state.draft.address)
        ) {
            return [];
        }
        if (state.draft.items.length > 0 && isAddressStructurallyComplete(state.draft.address)) {
            return [buildPaymentButtons()];
        }
        return [];
    }
    if (state.step === "pro_awaiting_confirmation") {
        return [buildConfirmationActionButtons(state.draft)];
    }
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
            outbound: [{ kind: "text", text: "Pagamento em cartão selecionado." }],
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
                    text: "Use um dos botões abaixo para escolher o pagamento.",
                },
                buildPaymentButtons(),
            ]),
        };
    }

    return null;
}

const ORPHAN_FINAL_CONFIRM_IDS = new Set(["pro_confirm_order", "btn_confirm_order", "btn_confirmar"]);

export { PICK_EMB_PREFIX } from "../productPickText";
export { applyProductPickFromInbound as applyProductPickFromButton } from "../productPickText";

export function buildClarificationButtons(
    picks: Array<{
        embalagemId: string;
        label: string;
        price?: number | null;
        productName?: string | null;
    }>
): OutboundMessage | null {
    const top = picks.slice(0, 3);
    if (top.length < 2) return null;
    const productHint = catalogProductHintFromPicks(top);
    return {
        kind: "buttons",
        text: formatSearchPicksClarificationBody(top, { productHint }),
        buttons: buildUniquePickButtons(top, PICK_EMB_PREFIX),
    };
}

/** Remove prosa da IA quando o servidor já envia o card de opções. */
function stripAiOptionListText(messages: OutboundMessage[]): OutboundMessage[] {
    return messages.filter((m) => {
        if (m.kind !== "text") return true;
        const t = String(m.text ?? "");
        const flat = t
            .toLowerCase()
            .normalize("NFD")
            .replaceAll(/\p{Diacritic}/gu, "");
        if (/^\s*\d+\s*[).:-]/mu.test(t) && (flat.includes("r$") || flat.includes("opcao") || flat.includes("heineken") || flat.includes("prefere"))) {
            return false;
        }
        if (flat.includes("encontrei algumas opcoes") || flat.includes("qual voce prefere")) {
            return false;
        }
        if (flat.includes("seu pedido") && flat.includes("proximo passo")) {
            return false;
        }
        return true;
    });
}

/** Em confirmação final: só o card canónico (sem texto IA paralelo). */
function keepOnlyFinalConfirmationCard(messages: OutboundMessage[], draft: OrderDraft): OutboundMessage[] {
    const card = buildConfirmationActionButtons(draft);
    const others = messages.filter(
        (m) => !(m.kind === "buttons" && m.buttons?.some((b) => b.id === "pro_confirm_order"))
    );
    const nonCheckoutText = others.filter((m) => {
        if (m.kind !== "text") return m.kind === "flow";
        const flat = String(m.text ?? "")
            .toLowerCase()
            .normalize("NFD")
            .replaceAll(/\p{Diacritic}/gu, "");
        if (flat.includes("resumo") || flat.includes("seu pedido") || flat.includes("endereco confirmado")) {
            return false;
        }
        if (flat.includes("r$") && flat.includes("pagamento")) return false;
        // Mantém prompts de Corrigir / Adicionar (“editar no pedido”, “produtos que quer adicionar”).
        if (flat.includes("editar") || flat.includes("adicionar") || flat.includes("acrescente")) {
            return flat.length > 0 && flat.length < 160;
        }
        return flat.length > 0 && flat.length < 80;
    });
    return [...nonCheckoutText, card];
}

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
                    text: "Esse passo já foi concluído ou não há pedido aberto para confirmar. Para novo pedido, envie os itens.",
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
            bootstrapResolvedEmbalagemIds: [],
            bootstrapPendingClarifications: [],
            lastSearchPicks: [],
            deliveryAddressUiConfirmed: false,
            checkoutEditHold: false,
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
            bootstrapResolvedEmbalagemIds: [],
            bootstrapPendingClarifications: [],
            lastSearchPicks: [],
            deliveryAddressUiConfirmed: false,
            checkoutEditHold: false,
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
            state: {
                ...state,
                step: "pro_collecting_order",
                checkoutEditHold: true,
                /** Evita botões de clarificação velhos (ex.: hambúrguer) após Corrigir. */
                lastSearchPicks: [],
                pendingSwapRemoveName: null,
            },
            outbound: [{ kind: "text", text: "Perfeito. Me diga o que você quer editar no pedido." }],
        };
    }

    if (action === "pro_add_items" || action === "btn_add_items") {
        return {
            handled: true,
            actionTag: action,
            state: {
                ...state,
                step: "pro_collecting_order",
                checkoutEditHold: true,
                lastSearchPicks: [],
                pendingSwapRemoveName: null,
            },
            outbound: [{ kind: "text", text: "Certo. Me diga os produtos que quer adicionar." }],
        };
    }

    /** Retomada de carrinho abandonado: o card do passo certo vem do post-process. */
    if (action === "pro_recover_cart" || action === "btn_recover_cart") {
        if (!state.draft || state.draft.items.length === 0) {
            return {
                handled: true,
                actionTag: "pro_recover_cart_expired",
                state: { ...state, step: "pro_idle", draft: null, checkoutEditHold: false },
                outbound: [
                    {
                        kind: "text",
                        text: "Esse carrinho não está mais disponível. Me diga o que você precisa que eu monto de novo.",
                    },
                ],
            };
        }
        const resumed = withResolvedSlotStep({ ...state, checkoutEditHold: false });
        return {
            handled: true,
            actionTag: "pro_recover_cart",
            state: resumed,
            outbound: isAddressStructurallyComplete(resumed.draft?.address ?? null)
                ? []
                : [
                      {
                          kind: "text",
                          text: "Ótimo! Falta só o endereço de entrega: rua, número, bairro, cidade e UF.",
                      },
                  ],
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
            outbound: [{ kind: "text", text: "Não entendi o valor do troco. Exemplo: 100,00." }],
        };
    }

    if (
        (action === "pro_confirm_saved_address" || action === "pro_confirm_typed_address") &&
        state.draft?.address
    ) {
        /** Botões legados: só marca confirmado; o card de resumo vem do post-process. */
        const merged: ProSessionState = { ...state, deliveryAddressUiConfirmed: true };
        return {
            handled: true,
            actionTag: action,
            state: withResolvedSlotStep(merged),
            outbound: [],
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
                                "Toque no botão abaixo para abrir o cadastro de endereço (CEP opcional). " +
                                "Se preferir, pode enviar o endereço em texto: rua, número, bairro, cidade e UF. " +
                                "Ex.: Rua Tangara, 850, Sao Mateus, Sorriso-MT.",
                            ctaLabel: "Cadastrar endereço",
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
                    text: "Informe o novo endereço: rua, número, bairro e cidade (todos obrigatórios). Exemplo: Rua Tangará, 850, São Mateus, Sorriso-MT.",
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
                    "Seu pedido já tem produtos. Para entregar, cadastre o endereço completo (rua, número, bairro, cidade e UF). " +
                    "O CEP é opcional e ajuda a preencher automaticamente. Use o formulário abaixo ou descreva tudo em uma mensagem.",
            },
            {
                kind: "flow",
                flow: {
                    flowId:    ref.flowId,
                    flowToken: `${ref.threadId}|${ref.companyId}|address_register`,
                    bodyText:
                        "Abra o formulário para cadastrar o endereço de entrega. Você também pode enviar o endereço em texto no chat.",
                    ctaLabel: "Cadastrar endereço",
                },
            }
        );
    }
    // Clarificação de produto: uma UI só (servidor), mesmo com draft parcial multi-item
    // (também em Corrigir/Adicionar com hold — step fica collecting).
    if (
        !showAddressRegistrationPrompt &&
        (nextState.lastSearchPicks?.length ?? 0) >= 2 &&
        (params.mode === "ai" || nextState.checkoutEditHold === true) &&
        nextState.step !== "pro_awaiting_confirmation"
    ) {
        const clarify = buildClarificationButtons(nextState.lastSearchPicks ?? []);
        if (clarify) {
            const stripped = stripAiOptionListText(outbound);
            outbound.length = 0;
            outbound.push(...stripped, clarify);
        }
    }

    // Escalação suave: muitas buscas vazias → cardápio
    if (
        params.mode === "ai" &&
        (nextState.emptySearchStreak ?? 0) >= 2 &&
        !(nextState.draft?.items?.length)
    ) {
        outbound.push({
            kind: "text",
            text: "Não encontrei esse produto no catálogo. Tente outro nome, ou abra o cardápio pelo botão Cardápio / menu da loja.",
        });
    }

    nextState = withResolvedSlotStep({
        ...nextState,
        step: resolveProStepFromDraft({
            step: nextState.step,
            draft: nextState.draft,
            deliveryAddressUiConfirmed: nextState.deliveryAddressUiConfirmed,
        }),
    });

    const checkoutCards = checkoutButtonsForState(nextState);
    if (nextState.step === "pro_awaiting_confirmation" && nextState.draft) {
        const composed = keepOnlyFinalConfirmationCard(
            [...outbound, ...checkoutCards],
            nextState.draft
        );
        return { state: nextState, outbound: composed };
    }

    outbound.push(...checkoutCards);

    /** Rede de segurança: com picks pendentes, nunca terminar sem UI de escolha. */
    if (
        (nextState.lastSearchPicks?.length ?? 0) >= 2 &&
        !outbound.some((m) => m.kind === "buttons")
    ) {
        const clarify = buildClarificationButtons(nextState.lastSearchPicks ?? []);
        if (clarify) outbound.push(clarify);
    }

    return { state: nextState, outbound: prioritizeInteractiveFirst(outbound) };
}

export function checkoutPostProcessForQuickAction(params: {
    state: ProSessionState;
    outbound: OutboundMessage[];
}): OutboundMessage[] {
    const state = withResolvedSlotStep(params.state);
    if (state.checkoutEditHold) {
        // Corrigir / Adicionar: não reenviar resumo de confirmação nesta volta.
        return prioritizeInteractiveFirst([...params.outbound]);
    }
    const cards = checkoutButtonsForState(state);
    if (state.step === "pro_awaiting_confirmation" && state.draft) {
        return keepOnlyFinalConfirmationCard([...params.outbound, ...cards], state.draft);
    }
    return prioritizeInteractiveFirst([...params.outbound, ...cards]);
}
