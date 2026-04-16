import type { IntentDecision, OutboundMessage, ProSessionState } from "@/src/types/contracts";
import { canTransition } from "../proStepTransitions";

export interface RouteStageResult {
    mode: "direct_reply" | "ai";
    state: ProSessionState;
    outbound: OutboundMessage[];
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

    if (decision.intent === "faq" || decision.intent === "greeting") {
        return {
            mode: "direct_reply",
            state,
            outbound: [{ kind: "text", text: "Posso te ajudar com pedido, status ou falar com atendente." }],
        };
    }

    return { mode: "ai", state, outbound: [] };
}

