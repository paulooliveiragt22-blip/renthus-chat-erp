import type { IntentDecision, OutboundMessage, ProSessionState } from "@/src/types/contracts";
import { canTransition } from "../proStepTransitions";

export interface RouteStageResult {
    mode: "direct_reply" | "ai";
    state: ProSessionState;
    outbound: OutboundMessage[];
}

function buildWelcomeText(isReturningCustomer: boolean): string {
    if (isReturningCustomer) {
        return (
            "Bem-vindo de volta! Posso agilizar seu pedido com seus dados salvos.\n\n" +
            "Você pode digitar o que precisa em uma frase (produto + quantidade) ou usar os botões abaixo."
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
}): RouteStageResult {
    const { state, decision } = params;

    if (decision.intent === "human_intent") {
        const tr = canTransition(state.step, { type: "intent_human_handover" });
        const step = tr.ok ? tr.to : "handover";
        return {
            mode: "direct_reply",
            state: { ...state, step },
            outbound: [{ kind: "text", text: "Vou te encaminhar para um atendente humano." }],
        };
    }

    if (decision.intent === "status_intent") {
        return {
            mode: "direct_reply",
            state,
            outbound: [{ kind: "text", text: "Vou verificar o status do seu pedido." }],
        };
    }

    if (decision.intent === "faq" || decision.intent === "greeting" || decision.intent === "unknown") {
        const isReturningCustomer = Boolean(state.customerId);
        return {
            mode: "direct_reply",
            state,
            outbound: [
                { kind: "text", text: buildWelcomeText(isReturningCustomer) },
                {
                    kind: "buttons",
                    text: "Posso te ajudar com pedido, status ou atendimento humano.",
                    buttons: mainMenuButtons(),
                },
            ],
        };
    }

    return { mode: "ai", state, outbound: [] };
}

