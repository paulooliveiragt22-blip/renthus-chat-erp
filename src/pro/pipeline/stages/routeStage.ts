import type { IntentDecision, OutboundMessage, ProSessionState, TenantRef } from "@/src/types/contracts";
import { buildWebMenuOfferText } from "@/lib/public-menu/menuOfferText";
import {
    buildWelcomeMenuBody,
    type ChatbotMessageTemplates,
} from "@/lib/chatbot/messageTemplates";
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

function mainMenuButtons(): Array<{ id: string; title: string }> {
    return [
        { id: "btn_catalog", title: "Cardapio" },
        { id: "btn_status", title: "Meu pedido" },
        { id: "btn_support", title: "Falar com atendente" },
    ];
}

export function routeStage(params: {
    state: ProSessionState;
    decision: IntentDecision;
    inboundText: string;
    tenant: TenantRef;
    flowCatalogId?: string | null;
    flowStatusId?: string | null;
    webMenuUrl?: string | null;
    messageTemplates?: ChatbotMessageTemplates | null;
}): RouteStageResult {
    const {
        state,
        decision,
        inboundText,
        tenant,
        flowCatalogId,
        flowStatusId,
        webMenuUrl,
        messageTemplates,
    } = params;
    const norm = normalizeInboundId(inboundText);

    if (decision.intent === "human_intent") {
        const tr = canTransition(state.step, { type: "intent_human_handover" });
        const step = tr.ok ? tr.to : "handover";
        return {
            mode: "direct_reply",
            state: { ...state, step },
            outbound: [{ kind: "text", text: "Vou te encaminhar para um atendente humano." }],
        };
    }

    if (wantsCatalogBrowse(norm) && webMenuUrl) {
        return {
            mode: "direct_reply",
            state,
            outbound: [
                {
                    kind: "text",
                    text: buildWebMenuOfferText({ url: webMenuUrl }),
                },
            ],
        };
    }

    if (wantsCatalogBrowse(norm) && flowCatalogId) {
        return {
            mode: "direct_reply",
            state,
            outbound: [
                {
                    kind: "flow",
                    flow: {
                        flowId:    flowCatalogId,
                        flowToken: `${tenant.threadId}|${tenant.companyId}|catalog`,
                        bodyText:  "Abra o formulário do catálogo para escolher os produtos.",
                        ctaLabel:  "Ver catálogo",
                    },
                },
            ],
        };
    }

    if (norm === "btn_status" && flowStatusId) {
        return {
            mode: "direct_reply",
            state,
            outbound: [
                {
                    kind: "flow",
                    flow: {
                        flowId:    flowStatusId,
                        flowToken: `${tenant.threadId}|${tenant.companyId}|status`,
                        bodyText:  "Consulte o status do seu pedido no formulário.",
                        ctaLabel:  "Ver status",
                    },
                },
            ],
        };
    }

    if (decision.intent === "status_intent" && flowStatusId) {
        return {
            mode: "direct_reply",
            state,
            outbound: [
                {
                    kind: "flow",
                    flow: {
                        flowId:    flowStatusId,
                        flowToken: `${tenant.threadId}|${tenant.companyId}|status`,
                        bodyText:  "Consulte o status do seu pedido no formulário.",
                        ctaLabel:  "Ver status",
                    },
                },
            ],
        };
    }

    if (decision.intent === "status_intent") {
        return {
            mode: "direct_reply",
            state,
            outbound: [{ kind: "text", text: "Vou verificar o status do seu pedido." }],
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

    if (norm === "btn_status") {
        return {
            mode: "direct_reply",
            state,
            outbound: [
                {
                    kind: "text",
                    text: "A consulta de pedido interativa não está configurada neste canal. Digite o número do pedido ou use Falar com atendente.",
                },
            ],
        };
    }

    if (decision.intent === "faq" || decision.intent === "greeting" || decision.intent === "unknown") {
        /** Defesa em profundidade: classificador ou LLM não devem reabrir o menu com pedido a meio. */
        if (isOrderSessionContinuityNeeded(state)) {
            return { mode: "ai", state, outbound: [] };
        }
        const isReturningCustomer = Boolean(state.customerId);
        /** Flow de cadastro de endereco: só após o pedido ter itens (ver `checkoutPostProcess`). */
        return {
            mode: "direct_reply",
            state,
            outbound: [
                {
                    kind: "buttons",
                    text: buildWelcomeMenuBody(isReturningCustomer, messageTemplates),
                    buttons: mainMenuButtons(),
                },
            ],
        };
    }

    return { mode: "ai", state, outbound: [] };
}
