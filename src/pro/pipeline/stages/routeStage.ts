import type { IntentDecision, OutboundMessage, ProSessionState, TenantRef } from "@/src/types/contracts";
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

/** Saudação única: corpo do interactive (uma bolha WhatsApp). */
function buildWelcomeBody(isReturningCustomer: boolean): string {
    if (isReturningCustomer) {
        return (
            "Bem-vindo de volta! Posso agilizar seu pedido com seus dados salvos.\n\n" +
            "Digite o que precisa (produto + endereco + pagamento) ou use os botões abaixo."
        );
    }
    return (
        "Oi! Sou o assistente da loja e te ajudo a fechar o pedido por aqui.\n\n" +
        "Se preferir, escreva tudo em uma frase (produto + endereco + pagamento) ou use os botões abaixo."
    );
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
    /** Flow WhatsApp para cadastro de endereco (primeiro contato / cadastro incompleto). */
    flowAddressRegisterId?: string | null;
    /** Payload de `buildOrderHintsPayload` quando prefetch em saudacao (opcional). */
    orderHints?: Record<string, unknown> | null;
}): RouteStageResult {
    const { state, decision, inboundText, tenant, flowCatalogId, flowStatusId, flowAddressRegisterId, orderHints } =
        params;
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

    if (norm === "btn_catalog" && flowCatalogId) {
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

    if (norm === "btn_catalog") {
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
        const needAddrFlow =
            Boolean(flowAddressRegisterId) && orderHints?.requires_address_flow_registration === true;
        if (decision.intent === "greeting" && needAddrFlow) {
            const reason = String(orderHints?.address_registration_reason_pt ?? "").trim();
            const extra = reason ? `\n\n${reason}` : "";
            return {
                mode: "direct_reply",
                state,
                outbound: [
                    {
                        kind: "text",
                        text: `Para continuar, precisamos do seu endereco completo de entrega (rua, numero, bairro, cidade e UF). O CEP e opcional e ajuda a preencher automaticamente.${extra}`,
                    },
                    {
                        kind: "flow",
                        flow: {
                            flowId:    flowAddressRegisterId!,
                            flowToken: `${tenant.threadId}|${tenant.companyId}|address_register`,
                            bodyText:  "Abra o formulario para cadastrar seu endereco.",
                            ctaLabel:  "Cadastrar endereco",
                        },
                    },
                    {
                        kind: "buttons",
                        text: buildWelcomeBody(isReturningCustomer),
                        buttons: mainMenuButtons(),
                    },
                ],
            };
        }
        return {
            mode: "direct_reply",
            state,
            outbound: [
                {
                    kind: "buttons",
                    text: buildWelcomeBody(isReturningCustomer),
                    buttons: mainMenuButtons(),
                },
            ],
        };
    }

    return { mode: "ai", state, outbound: [] };
}
