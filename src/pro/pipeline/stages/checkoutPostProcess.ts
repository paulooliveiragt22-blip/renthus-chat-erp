import type { OutboundMessage, OrderDraft, ProSessionState } from "@/src/types/contracts";
import {
    formatCanonicalDraftSummary,
    formatSearchPicksClarificationBody,
} from "../orderDraftPresenter";
import { PICK_ADDRESS_PREFIX } from "../serverPrepareAfterAddressPick";
import { PICK_EMB_PREFIX, parseProductPickIndex } from "../productPickText";
import { buildUniquePickButtons } from "../pickButtonTitles";
import { catalogProductHintFromPicks } from "../catalogProductHint";
import { isDraftBelowMinimumOrder } from "../orderDraftGate";
import {
    isAddressStructurallyComplete,
    resolveProStepFromDraft,
    withResolvedSlotStep,
} from "../orderSlotStep";
import {
    looksLikeNonMoneyWhileAwaitingChange,
    parsePtMoneyInput,
} from "../paymentFromUserText";
import { resolveCheckoutTurnOutcome } from "../resolveCheckoutTurnOutcome";
import { buildPickClarificationFreeText } from "../pendingPickGroups";
import {
    applyFulfillmentPolicyToDraft,
    applyPickupTotals,
    assertFulfillmentAllowed,
    DEFAULT_FULFILLMENT_POLICY,
    isFulfillmentUnavailable,
    isPickupDraft,
    needsFulfillmentChoice,
    parseFulfillmentType,
    type FulfillmentPolicy,
} from "@/lib/delivery/fulfillment";

export interface QuickActionResult {
    handled: boolean;
    actionTag: string | null;
    state: ProSessionState;
    outbound: OutboundMessage[];
}

/** Quando definido, o botão «Alterar» endereço manda o cliente ao cardápio web (carrinho pré-carregado). */
export type CheckoutHandoffQuickOpts = {
    url: string;
};

export type CheckoutQuickActionOpts = {
    checkoutHandoffUrl?: string | null;
    fulfillmentPolicy?: FulfillmentPolicy;
};

function normalizeInboundAction(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "");
}

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

function brl(value: number): string {
    return value.toFixed(2).replace(".", ",");
}

/**
 * Resposta determinística (sem IA) quando o rascunho não bate o pedido mínimo — usada nos
 * quick actions de pagamento, que mexem no draft direto sem passar pelo `prepare_order_draft`.
 */
function buildMinimumOrderShortfallMessage(draft: OrderDraft): OutboundMessage {
    const min = draft.deliveryMinOrder ?? 0;
    const missing = Math.max(0, min - draft.grandTotal);
    return {
        kind: "text",
        text:
            `Seu pedido está em R$ ${brl(draft.grandTotal)} e o mínimo para entrega é R$ ${brl(min)} ` +
            `(faltam R$ ${brl(missing)}). Me diga o que mais você quer adicionar.`,
    };
}

type SavedAddressHint = {
    id: string;
    apelido?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    is_principal?: boolean | null;
};

/** Rótulo curto de botão (≤20 chars, WhatsApp): apelido customizado, senão papel genérico. */
function addressChoiceButtonLabel(row: SavedAddressHint, fallback: string): string {
    const apelido = String(row.apelido ?? "").trim();
    const isCustom = apelido.length > 0 && apelido.toLowerCase() !== "principal";
    return (isCustom ? apelido : fallback).slice(0, 20);
}

function addressChoiceShortLine(row: SavedAddressHint): string {
    const street = [row.logradouro, row.numero].filter(Boolean).join(", ");
    return row.bairro ? `${street} - ${row.bairro}` : street;
}

/** Botões: endereço mais usado (mais entregas) vs. do pedido mais recente, quando diferem. */
export function buildAddressChoiceButtons(
    primary: SavedAddressHint,
    secondary: SavedAddressHint
): OutboundMessage {
    const labelA = addressChoiceButtonLabel(primary, "Endereço usual");
    let labelB = addressChoiceButtonLabel(secondary, "Último pedido");
    if (labelB.toLowerCase() === labelA.toLowerCase()) labelB = "Último pedido";
    return {
        kind: "buttons",
        text:
            "Encontrei mais de um endereço seu. Pra qual entregamos este pedido?\n\n" +
            `${labelA}: ${addressChoiceShortLine(primary)}\n` +
            `${labelB}: ${addressChoiceShortLine(secondary)}\n\n` +
            "Ou me envie um novo endereço.",
        buttons: [
            { id: `${PICK_ADDRESS_PREFIX}${primary.id}`, title: labelA },
            { id: `${PICK_ADDRESS_PREFIX}${secondary.id}`, title: labelB },
            { id: "pro_new_address_flow", title: "Outro endereço" },
        ],
    };
}

/** Extrai os 2 candidatos (most_used vs last_used) do payload de `get_order_hints`, quando diferentes. */
function extractAddressChoiceCandidates(
    orderHints: Record<string, unknown> | null | undefined
): { primary: SavedAddressHint; secondary: SavedAddressHint } | null {
    const list = Array.isArray(orderHints?.saved_addresses)
        ? (orderHints!.saved_addresses as SavedAddressHint[])
        : [];
    if (list.length < 2) return null;
    const primaryId = String(orderHints?.most_used_address_id ?? "").trim();
    const secondaryId = String(orderHints?.last_used_address_id ?? "").trim();
    if (!primaryId || !secondaryId || primaryId === secondaryId) return null;
    const primary = list.find((a) => a.id === primaryId);
    const secondary = list.find((a) => a.id === secondaryId);
    if (!primary || !secondary) return null;
    return { primary, secondary };
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
    const interactive = messages.filter(
        (m) => m.kind === "buttons" || m.kind === "flow" || m.kind === "cta_url"
    );
    const plain = messages.filter((m) => m.kind === "text");
    return [...interactive, ...plain];
}

function buildFulfillmentButtons(): OutboundMessage {
    return {
        kind: "buttons",
        text: "Como você prefere receber este pedido?",
        buttons: [
            { id: "pro_fulfillment_delivery", title: "Entrega" },
            { id: "pro_fulfillment_pickup", title: "Retirar no local" },
        ],
    };
}

function checkoutAddressReady(draft: OrderDraft): boolean {
    return isPickupDraft(draft) || isAddressStructurallyComplete(draft.address);
}

function checkoutButtonsForState(
    state: ProSessionState,
    policy: FulfillmentPolicy = DEFAULT_FULFILLMENT_POLICY
): OutboundMessage[] {
    if (!state.draft) return [];
    if ((state.pendingAskRepeatTerms?.length ?? 0) > 0) return [];
    if ((state.lastSearchPicks?.length ?? 0) >= 2) return [];
    if ((state.pendingPickGroups?.length ?? 0) > 0) return [];
    if ((state.bootstrapPendingClarifications?.length ?? 0) > 0) return [];
    if (isFulfillmentUnavailable(policy) && state.draft.items.length > 0) {
        return [];
    }
    if (!state.draft.paymentMethod) {
        if (needsFulfillmentChoice(policy, state.draft.fulfillmentType) && state.draft.items.length > 0) {
            return [buildFulfillmentButtons()];
        }
        if (state.draft.items.length > 0 && !checkoutAddressReady(state.draft)) {
            return [];
        }
        if (
            state.draft.items.length > 0 &&
            checkoutAddressReady(state.draft) &&
            !isDraftBelowMinimumOrder(state.draft)
        ) {
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
    if (action === "pro_pay_pix" || action === "pro_pay_card") {
        const paymentMethod = action === "pro_pay_pix" ? "pix" : "card";
        const nextDraft: OrderDraft = { ...state.draft, paymentMethod, changeFor: null };
        if (isDraftBelowMinimumOrder(nextDraft)) {
            return {
                handled: true,
                actionTag: action,
                state: { ...state, step: "pro_collecting_order", draft: nextDraft },
                outbound: [buildMinimumOrderShortfallMessage(nextDraft)],
            };
        }
        return {
            handled: true,
            actionTag: action,
            state: { ...state, step: "pro_collecting_order", draft: nextDraft },
            outbound: [],
        };
    }
    if (action === "pro_pay_cash") {
        const nextDraft: OrderDraft = { ...state.draft, paymentMethod: "cash" };
        if (isDraftBelowMinimumOrder(nextDraft)) {
            return {
                handled: true,
                actionTag: action,
                state: { ...state, step: "pro_collecting_order", draft: nextDraft },
                outbound: [buildMinimumOrderShortfallMessage(nextDraft)],
            };
        }
        return {
            handled: true,
            actionTag: action,
            state: { ...state, step: "pro_awaiting_change_amount", draft: nextDraft },
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

function outboundHasPaymentButtons(messages: OutboundMessage[]): boolean {
    return messages.some(
        (m) =>
            m.kind === "buttons" &&
            (m.buttons ?? []).some((b) => PAYMENT_BUTTON_IDS.has(String(b.id ?? "")))
    );
}

/** Pick de embalagem (botão ou número) não pode ser barrado pelo gate de pagamento. */
function looksLikePendingProductPick(text: string, state: ProSessionState): boolean {
    const raw = text.trim();
    if (!raw) return false;
    if (raw.toLowerCase().startsWith(PICK_EMB_PREFIX)) return true;
    if ((state.lastSearchPicks?.length ?? 0) < 2) return false;
    if (parseProductPickIndex(raw) != null) return true;
    // Título do botão WhatsApp: "1) SALGADINHO…"
    if (/^\s*\d+\s*[).:-]/u.test(raw)) return true;
    return false;
}

/**
 * Checkout estruturado: (1) em pagamento só botões; (2) antes disso, pagamento por texto/botão
 * só depois de confirmar endereço no servidor.
 */
export function strictCheckoutStructuredGate(text: string, state: ProSessionState): QuickActionResult | null {
    const action = normalizeInboundAction(text);
    const d = state.draft;

    /** Aguardando o cliente repetir o nome do produto — não barrar como pagamento. */
    if ((state.pendingAskRepeatTerms?.length ?? 0) > 0) return null;

    if (state.step === "pro_awaiting_payment_method" && d) {
        if (!action) return null;
        if (isCancelOrderPlainText(text)) return null;
        if (PAYMENT_BUTTON_IDS.has(action)) return null;
        if (parseFulfillmentType(text) != null) return null;
        if (looksLikePendingProductPick(text, state)) return null;
        return {
            handled: true,
            actionTag: "strict_payment_inbound_gate",
            state,
            /** Só reenvia os botões — sem texto extra. */
            outbound: [buildPaymentButtons()],
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
    opts?: CheckoutQuickActionOpts
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
            pendingOrderMentions: [],
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
            pendingOrderMentions: [],
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
        const pickup = isPickupDraft(resumed.draft);
        const askAddress =
            !pickup &&
            resumed.draft?.fulfillmentType === "delivery" &&
            !isAddressStructurallyComplete(resumed.draft?.address ?? null);
        return {
            handled: true,
            actionTag: "pro_recover_cart",
            state: resumed,
            outbound: askAddress
                ? [
                      {
                          kind: "text",
                          text: "Ótimo! Falta só o endereço de entrega: rua, número, bairro, cidade e UF.",
                      },
                  ]
                : [],
        };
    }

    const paymentAction = resolvePaymentQuickAction(action, state);
    if (paymentAction) return paymentAction;

    const fulfillmentChoice = parseFulfillmentType(text);
    if (fulfillmentChoice && state.draft && state.draft.items.length > 0) {
        const policy = opts?.fulfillmentPolicy ?? DEFAULT_FULFILLMENT_POLICY;
        const type = fulfillmentChoice;
        const allowed = assertFulfillmentAllowed(policy, type);
        if (!allowed.ok) {
            const msg =
                allowed.error === "pickup_disabled"
                    ? "No momento não estamos aceitando retirada no local. Posso enviar por entrega."
                    : "No momento não estamos fazendo entregas. Você pode retirar no local.";
            return {
                handled: true,
                actionTag: type === "pickup" ? "pro_fulfillment_pickup" : "pro_fulfillment_delivery",
                state,
                outbound: [{ kind: "text", text: msg }],
            };
        }
        const nextDraft =
            type === "pickup"
                ? applyPickupTotals({ ...state.draft, fulfillmentType: "pickup" })
                : { ...state.draft, fulfillmentType: "delivery" as const };
        const merged: ProSessionState = {
            ...state,
            draft: nextDraft,
            deliveryAddressUiConfirmed: type === "pickup",
        };
        const addrReady = isAddressStructurallyComplete(nextDraft.address);
        return {
            handled: true,
            actionTag: type === "pickup" ? "pro_fulfillment_pickup" : "pro_fulfillment_delivery",
            state: withResolvedSlotStep(merged),
            outbound:
                type === "pickup"
                    ? [{ kind: "text", text: "Combinado: retirada no local, sem taxa de entrega." }]
                    : addrReady
                      ? []
                      : [
                            {
                                kind: "text",
                                text: "Combinado: entrega. Me envia o endereço: rua, número, bairro, cidade e UF.",
                            },
                        ],
        };
    }

    if (state.step === "pro_awaiting_change_amount" && state.draft?.paymentMethod === "cash") {
        /** “tem coca 2l?” / “exatamente” não são valor de troco — libera o slot. */
        if (looksLikeNonMoneyWhileAwaitingChange(text)) {
            return {
                handled: false,
                actionTag: null,
                state: {
                    ...state,
                    step: "pro_collecting_order",
                },
                outbound: [],
            };
        }
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

    /**
     * `pro_pick_address:<enderecoClienteId>` é resolvido ANTES deste gate (server-side, com
     * `admin`) em `runProPipeline` via `serverPrepareAfterAddressPick` — recalcula taxa/zona de
     * entrega com `prepare_order_draft`. Se chegou aqui sem draft, o carrinho já não existe mais.
     */
    if (action.startsWith(PICK_ADDRESS_PREFIX)) {
        return {
            handled: true,
            actionTag: "pro_pick_address_no_draft",
            state,
            outbound: [
                {
                    kind: "text",
                    text: "Esse carrinho não está mais disponível. Me diga o que você precisa que eu monto de novo.",
                },
            ],
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
        const handoffUrl = opts?.checkoutHandoffUrl?.trim();
        if (handoffUrl) {
            return {
                handled: true,
                actionTag: action,
                state: withResolvedSlotStep(merged),
                outbound: [
                    {
                        kind: "cta_url",
                        ctaUrl: {
                            bodyText:
                                "Toque para cadastrar o endereço e finalizar no cardápio. " +
                                "Se preferir, envie o endereço em texto: rua, número, bairro, cidade e UF.",
                            displayText: "Cadastrar endereço",
                            url: handoffUrl,
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
    /** URL do cardápio com carrinho (handoff). Sem Flow Meta. */
    checkoutHandoffUrl?: string | null;
    /** Resultado de `buildOrderHintsPayload` quando o checkout precisa decidir cadastro. */
    orderHints?: Record<string, unknown> | null;
    /**
     * `true` quando o modelo sinalizou `ADDR_FREE_TEXT` neste turno (respondeu em texto livre
     * sobre endereço porque o cliente questionou/mencionou entrega em outro lugar).
     * Suprime os botões de escolha de endereço para não duplicar a pergunta.
     */
    addressFreeTextSignaled?: boolean;
    fulfillmentPolicy?: FulfillmentPolicy;
}): { state: ProSessionState; outbound: OutboundMessage[] } {
    const policy = params.fulfillmentPolicy ?? DEFAULT_FULFILLMENT_POLICY;
    let nextState = params.state;
    if (nextState.draft) {
        const draft = applyFulfillmentPolicyToDraft(nextState.draft, policy);
        if (draft !== nextState.draft) {
            nextState = { ...nextState, draft };
        }
    }
    const outbound = [...params.outbound];

    if (isFulfillmentUnavailable(policy) && nextState.draft && nextState.draft.items.length > 0) {
        outbound.push({
            kind: "text",
            text: "No momento a loja não está aceitando pedidos de entrega nem de retirada.",
        });
    }

    const addrComplete =
        Boolean(nextState.draft?.address) && isAddressStructurallyComplete(nextState.draft!.address);
    const skipAddressUi =
        isPickupDraft(nextState.draft) ||
        needsFulfillmentChoice(policy, nextState.draft?.fulfillmentType);
    const needAddrRegistration = params.orderHints?.requires_address_flow_registration === true;
    const handoffUrl = params.checkoutHandoffUrl?.trim() ?? "";
    const showAddressRegistrationPrompt =
        params.mode === "ai" &&
        Boolean(handoffUrl) &&
        needAddrRegistration &&
        nextState.draft &&
        nextState.draft.items.length > 0 &&
        !addrComplete &&
        !skipAddressUi &&
        nextState.deliveryAddressUiConfirmed !== true;
    if (showAddressRegistrationPrompt && handoffUrl) {
        outbound.push(
            {
                kind: "text",
                text:
                    "Seu pedido já tem produtos. Para entregar, cadastre o endereço completo no cardápio " +
                    "(rua, número, bairro, cidade e UF) ou descreva tudo em uma mensagem.",
            },
            {
                kind: "cta_url",
                ctaUrl: {
                    bodyText: "Abra o cardápio para cadastrar o endereço e finalizar o pedido.",
                    displayText: "Cadastrar endereço",
                    url: handoffUrl,
                },
            }
        );
    }
    // Clarificação de produto: uma UI só (servidor), mesmo com draft parcial multi-item
    // (também em Corrigir/Adicionar com hold — step fica collecting).
    const turnOutcome = resolveCheckoutTurnOutcome({
        state: nextState,
        mode: params.mode,
        showAddressRegistrationPrompt: Boolean(showAddressRegistrationPrompt),
        fulfillmentPolicy: policy,
    });
    /**
     * Embalagem ambígua de 1+ produtos: descarta TODO texto da IA (nunca só um filtro por
     * regex) e usa a pergunta consolidada determinística — elimina tanto a duplicidade quanto
     * o risco de a IA alucinar disponibilidade/preço na prosa (Frente 1 do diagnóstico do S2).
     */
    if (turnOutcome.kind === "clarify_pending_picks") {
        outbound.length = 0;
        outbound.push({
            kind: "text",
            text: buildPickClarificationFreeText(nextState.pendingPickGroups ?? []),
        });
    }

    if (turnOutcome.kind === "clarify_product_picks") {
        const clarify = buildClarificationButtons(nextState.lastSearchPicks ?? []);
        if (clarify) {
            const stripped = stripAiOptionListText(outbound);
            outbound.length = 0;
            outbound.push(...stripped, clarify);
        }
    }

    // Escalação suave: muitas buscas vazias → cardápio
    if (turnOutcome.kind === "empty_search_hint") {
        outbound.push({
            kind: "text",
            text: "Não encontrei esse produto no catálogo. Tente outro nome, ou abra o cardápio pelo botão Cardápio / menu da loja.",
        });
    }

    // Endereço com 2 candidatos reais (mais usado ≠ pedido mais recente): botão em vez de
    // pergunta em texto — a IA não deve repetir isso na prosa (ver instruções do system prompt).
    if (
        turnOutcome.kind === "collecting" &&
        params.mode === "ai" &&
        !params.addressFreeTextSignaled &&
        !skipAddressUi &&
        !outbound.some((m) => m.kind === "buttons" || m.kind === "flow")
    ) {
        const candidates = extractAddressChoiceCandidates(params.orderHints);
        if (candidates) {
            outbound.push(buildAddressChoiceButtons(candidates.primary, candidates.secondary));
        }
    }

    nextState = withResolvedSlotStep({
        ...nextState,
        step: resolveProStepFromDraft({
            step: nextState.step,
            draft: nextState.draft,
            deliveryAddressUiConfirmed: nextState.deliveryAddressUiConfirmed,
        }),
    });

    const checkoutCards = checkoutButtonsForState(nextState, policy);
    if (nextState.step === "pro_awaiting_confirmation" && nextState.draft) {
        const composed = keepOnlyFinalConfirmationCard(
            [...outbound, ...checkoutCards],
            nextState.draft
        );
        return { state: nextState, outbound: composed };
    }

    const cardsToAdd = outboundHasPaymentButtons(outbound)
        ? checkoutCards.filter((c) => !outboundHasPaymentButtons([c]))
        : checkoutCards;
    outbound.push(...cardsToAdd);

    /** Rede de segurança: com picks pendentes, nunca terminar sem UI de escolha. */
    if (
        turnOutcome.kind !== "clarify_pending_picks" &&
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
    fulfillmentPolicy?: FulfillmentPolicy;
}): OutboundMessage[] {
    const policy = params.fulfillmentPolicy ?? DEFAULT_FULFILLMENT_POLICY;
    const state = withResolvedSlotStep(params.state);
    if (state.checkoutEditHold) {
        // Corrigir / Adicionar: não reenviar resumo de confirmação nesta volta.
        return prioritizeInteractiveFirst([...params.outbound]);
    }
    const cards = checkoutButtonsForState(state, policy);
    if (state.step === "pro_awaiting_confirmation" && state.draft) {
        return keepOnlyFinalConfirmationCard([...params.outbound, ...cards], state.draft);
    }
    /** Evita duplicar PIX/Cartão/Dinheiro quando o caller já incluiu o card. */
    const cardsToAdd = outboundHasPaymentButtons(params.outbound)
        ? cards.filter((c) => !outboundHasPaymentButtons([c]))
        : cards;
    return prioritizeInteractiveFirst([...params.outbound, ...cardsToAdd]);
}
