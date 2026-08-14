import type { IntentDecision, OutboundMessage, ProSessionState, TenantRef } from "@/src/types/contracts";
import {
    buildWelcomeMenuBody,
    type ChatbotMessageTemplates,
} from "@/lib/chatbot/messageTemplates";
import { withMenuSearchParams } from "@/lib/public-menu/menuUrlQuery";
import { isOrderSessionContinuityNeeded } from "../sessionOrderContext";
import { canTransition } from "../proStepTransitions";

export interface RouteStageResult {
    mode: "direct_reply" | "ai";
    state: ProSessionState;
    outbound: OutboundMessage[];
}

function normalizeInboundId(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "");
}

/** Pedido explícito de ver o cardápio/catálogo (botão ou frase curta). */
function wantsCatalogBrowse(norm: string): boolean {
    if (norm === "btn_catalog" || norm === "1") return true;
    return /^(quero\s+)?(ver\s+)?(o\s+)?(cardapio|catalogo|menu)(\s+por\s+favor)?$/u.test(norm);
}

/** Continuar pedido no chat (botão do menu de boas-vindas). */
function wantsContinueOrder(norm: string): boolean {
    return norm === "btn_order";
}

/**
 * WhatsApp: máx 3 reply buttons (20 chars).
 * Ao tocar em Abrir cardápio (`btn_catalog`), o servidor envia CTA URL (link atrás do botão).
 */
export function mainMenuButtons(): Array<{ id: string; title: string }> {
    return [
        { id: "btn_catalog", title: "Abrir cardápio" },
        { id: "btn_status", title: "Meus pedidos" },
        { id: "btn_support", title: "Falar com atendente" },
    ];
}

export function buildWebMenuCtaOutbound(
    webMenuUrl: string,
    copy?: { bodyText?: string; displayText?: string }
): OutboundMessage {
    return {
        kind: "cta_url",
        ctaUrl: {
            bodyText: copy?.bodyText?.trim() || "Toque para abrir o cardápio no celular:",
            displayText: copy?.displayText?.trim() || "Abrir cardápio",
            url: webMenuUrl.trim(),
        },
    };
}

function welcomeOutbound(params: {
    state: ProSessionState;
    messageTemplates?: ChatbotMessageTemplates | null;
    webMenuUrl?: string | null;
}): OutboundMessage[] {
    const isReturningCustomer = Boolean(params.state.customerId);
    return [
        {
            kind: "buttons",
            text: buildWelcomeMenuBody(isReturningCustomer, params.messageTemplates),
            buttons: mainMenuButtons(),
        },
    ];
}

export function routeStage(params: {
    state: ProSessionState;
    decision: IntentDecision;
    inboundText: string;
    tenant: TenantRef;
    webMenuUrl?: string | null;
    messageTemplates?: ChatbotMessageTemplates | null;
    /**
     * true = IA com crédito (faq/unknown vão ao LLM).
     * Saudação sem pedido ativo: sempre menu de botões (não cola URL no texto).
     */
    llmEnabled?: boolean;
}): RouteStageResult {
    const {
        state,
        decision,
        inboundText,
        webMenuUrl,
        messageTemplates,
        llmEnabled = true,
    } = params;
    const norm = normalizeInboundId(inboundText);

    if (decision.intent === "human_intent") {
        const tr = canTransition(state.step, { type: "intent_human_handover" });
        const step = tr.ok ? tr.to : "handover";
        return {
            mode: "direct_reply",
            state: { ...state, step },
            outbound: [
                {
                    kind: "text",
                    text:
                        "Vou te conectar com um atendente.\n\n" +
                        "_Aguarde, alguém responderá em breve._",
                },
            ],
        };
    }

    if (wantsContinueOrder(norm)) {
        return {
            mode: "direct_reply",
            state: {
                ...state,
                step: state.step === "pro_idle" ? "pro_collecting_order" : state.step,
            },
            outbound: [
                {
                    kind: "text",
                    text: "Perfeito! Me diga o que deseja pedir (produto e quantidade).",
                },
            ],
        };
    }

    if (wantsCatalogBrowse(norm) && webMenuUrl) {
        return {
            mode: "direct_reply",
            state,
            outbound: [buildWebMenuCtaOutbound(webMenuUrl)],
        };
    }

    if ((norm === "btn_status" || decision.intent === "status_intent") && webMenuUrl) {
        return {
            mode: "direct_reply",
            state,
            outbound: [
                buildWebMenuCtaOutbound(withMenuSearchParams(webMenuUrl, { orders: "1" }), {
                    bodyText: "Toque para ver seus pedidos:",
                    displayText: "Meus pedidos",
                }),
            ],
        };
    }

    if (wantsCatalogBrowse(norm)) {
        return {
            mode: "direct_reply",
            state,
            outbound: [
                {
                    kind: "text",
                    text: "O catálogo interativo não está configurado neste canal. Descreva o produto que deseja, por favor.",
                },
            ],
        };
    }

    if (norm === "btn_status" || decision.intent === "status_intent") {
        return {
            mode: "direct_reply",
            state,
            outbound: [
                {
                    kind: "text",
                    text: "A consulta de pedido não está configurada neste canal. Digite o número do pedido ou use Falar com atendente.",
                },
            ],
        };
    }

    if (decision.intent === "faq" || decision.intent === "greeting" || decision.intent === "unknown") {
        /** Defesa em profundidade: classificador ou LLM não devem reabrir o menu com pedido a meio. */
        if (isOrderSessionContinuityNeeded(state)) {
            return { mode: "ai", state, outbound: [] };
        }
        /**
         * Saudação: menu de botões no servidor (mesmo com LLM ligado).
         * Evita o modelo colar URL longa do cardápio no texto.
         */
        if (decision.intent === "greeting") {
            return {
                mode: "direct_reply",
                state,
                outbound: welcomeOutbound({ state, messageTemplates, webMenuUrl }),
            };
        }
        /** FAQ / unknown com IA: LLM. Sem IA: mesmo menu. */
        if (llmEnabled) {
            return { mode: "ai", state, outbound: [] };
        }
        return {
            mode: "direct_reply",
            state,
            outbound: welcomeOutbound({ state, messageTemplates, webMenuUrl }),
        };
    }

    return { mode: "ai", state, outbound: [] };
}
