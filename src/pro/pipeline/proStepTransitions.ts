import type {
    AiServiceAction,
    OrderServiceResult,
    ProPipelineTelemetryReason,
    ProStep,
} from "@/src/types/contracts";

/** Eventos semânticos que alteram `ProSessionState.step` no pipeline PRO (R1). */
export type ProStepEvent =
    | { type: "ai_action_resolved"; action: AiServiceAction }
    | {
          type: "order_stage";
          outcome:
              | "gate_no_draft"
              | "gate_draft_incomplete"
              | "order_created_ok"
              | "order_create_failed";
      }
    | { type: "intent_human_handover" };

export type CanTransitionResult =
    | { ok: true; to: ProStep }
    | { ok: false; reason: ProPipelineTelemetryReason };

function mapAiActionToStep(action: AiServiceAction): ProStep {
    if (action === "request_confirmation") return "pro_awaiting_confirmation";
    if (action === "escalate") return "pro_escalation_choice";
    return "pro_collecting_order";
}

/**
 * Único catálogo de transições de `ProStep` permitidas no motor PRO.
 * Usar nos estágios em vez de atribuir `step` solto.
 */
export function canTransition(from: ProStep, event: ProStepEvent): CanTransitionResult {
    if (event.type === "intent_human_handover") {
        return { ok: true, to: "handover" };
    }

    if (event.type === "ai_action_resolved") {
        if (from === "handover") {
            return { ok: false, reason: "invalid_state_transition" };
        }
        return { ok: true, to: mapAiActionToStep(event.action) };
    }

    if (event.type === "order_stage") {
        if (from !== "pro_awaiting_confirmation") {
            return { ok: false, reason: "invalid_state_transition" };
        }
        switch (event.outcome) {
            case "order_created_ok":
                return { ok: true, to: "pro_idle" };
            case "gate_no_draft":
            case "gate_draft_incomplete":
            case "order_create_failed":
                return { ok: true, to: "pro_collecting_order" };
        }
    }

    return { ok: false, reason: "invalid_state_transition" };
}

/** Resolve o próximo passo após IA; fallback seguro se a combinação for inválida. */
export function resolveStepAfterAiAction(from: ProStep, action: AiServiceAction): ProStep {
    const r = canTransition(from, { type: "ai_action_resolved", action });
    return r.ok ? r.to : "pro_collecting_order";
}

/** Resolve o próximo passo após `orderStage` (só válido em `pro_awaiting_confirmation`). */
export function resolveStepAfterOrderStage(
    from: ProStep,
    outcome: Extract<ProStepEvent, { type: "order_stage" }>["outcome"]
): ProStep {
    const r = canTransition(from, { type: "order_stage", outcome });
    return r.ok ? r.to : from;
}

/**
 * Executa o RPC de criação de pedido "dentro" da transição de estado.
 * Se `from` for inválido para confirmação, o RPC não roda.
 */
export async function executeOrderRpcTransition(params: {
    from: ProStep;
    runCreateFromDraft: () => Promise<OrderServiceResult>;
}): Promise<{
    executed: boolean;
    nextStep: ProStep;
    outcome: "order_created_ok" | "order_create_failed";
    orderResult?: OrderServiceResult;
}> {
    const { from, runCreateFromDraft } = params;
    if (from !== "pro_awaiting_confirmation") {
        return {
            executed: false,
            nextStep: from,
            outcome: "order_create_failed",
        };
    }

    const orderResult = await runCreateFromDraft();
    const outcome = orderResult.ok ? "order_created_ok" : "order_create_failed";
    return {
        executed: true,
        nextStep: resolveStepAfterOrderStage(from, outcome),
        outcome,
        orderResult,
    };
}
