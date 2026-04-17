import type {
    IntentDecision,
    OrderServiceResult,
    ProSessionState,
    TenantRef,
} from "@/src/types/contracts";
import type { LoggerPort } from "../../ports/logger.port";
import type { OrderService } from "../../services/order/order.types";
import { hasPersistedDraftAndCustomer, isDraftStructurallyCompleteForFinalize } from "../orderDraftGate";
import { executeOrderRpcTransition, resolveStepAfterOrderStage } from "../proStepTransitions";

/** Resultado do estágio de pedido para telemetria e testes (gates antes de `createFromDraft`). */
export type OrderStageOutcome =
    | "skipped_not_awaiting"
    | "skipped_weak_confirmation"
    | "gate_no_draft"
    | "gate_draft_incomplete"
    | "order_created_ok"
    | "order_create_failed";

export interface OrderStageResult {
    state: ProSessionState;
    outboundText?: string;
    orderResult?: OrderServiceResult;
    outcome: OrderStageOutcome;
}

function isExplicitConfirmation(text: string): boolean {
    const raw = text.trim();
    if (!raw || raw.length > 64) return false;

    const normalized = raw
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .trim();

    if (/\b(nao|nunca|jamais|cancelar|cancela|desistir|desiste)\b/u.test(normalized)) {
        return false;
    }

    // IDs de botões/lista podem chegar no texto após extração do webhook.
    const confirmationIds = new Set([
        "confirmar",
        "confirmar_pedido",
        "confirm_order",
        "pro_confirm_order",
        "btn_confirmar",
    ]);
    if (confirmationIds.has(normalized)) return true;

    return /^(sim|ok|okay|confirmo|confirmar|pode\s+confirmar|pode\s+fechar|fechar(?:\s+pedido)?)\W*$/iu.test(
        raw
    );
}

export async function orderStage(params: {
    orderService: OrderService;
    tenant: TenantRef;
    state: ProSessionState;
    decision: IntentDecision;
    userText: string;
    logger?: LoggerPort;
}): Promise<OrderStageResult> {
    const { orderService, tenant, state, userText, logger } = params;

    if (state.step !== "pro_awaiting_confirmation") {
        return { state, outcome: "skipped_not_awaiting" };
    }
    if (!isExplicitConfirmation(userText)) {
        return { state, outcome: "skipped_weak_confirmation" };
    }
    if (!hasPersistedDraftAndCustomer(state)) {
        logger?.warn("pro_pipeline.order_stage_gate", {
            outcome: "gate_no_draft",
            companyId: tenant.companyId,
            threadId: tenant.threadId,
        });
        return {
            state: { ...state, step: resolveStepAfterOrderStage(state.step, "gate_no_draft") },
            outboundText: "Não encontrei um rascunho de pedido para confirmar. Me diga os itens novamente.",
            outcome: "gate_no_draft",
        };
    }

    if (!isDraftStructurallyCompleteForFinalize(state.draft)) {
        logger?.warn("pro_pipeline.order_stage_gate", {
            outcome: "gate_draft_incomplete",
            companyId: tenant.companyId,
            threadId: tenant.threadId,
        });
        return {
            state: { ...state, step: resolveStepAfterOrderStage(state.step, "gate_draft_incomplete") },
            outboundText: "Seu pedido ainda está incompleto. Vamos revisar itens, endereço e pagamento antes de confirmar.",
            outcome: "gate_draft_incomplete",
        };
    }

    const transition = await executeOrderRpcTransition({
        from: state.step,
        runCreateFromDraft: async () =>
            orderService.createFromDraft({
                tenant,
                customerId: state.customerId,
                draft: state.draft,
                idempotencyKey: `${tenant.companyId}:${tenant.threadId}:${tenant.messageId}`,
            }),
    });
    if (!transition.executed || !transition.orderResult) {
        logger?.warn("pro_pipeline.order_create_aborted", {
            companyId: tenant.companyId,
            threadId: tenant.threadId,
            executed: transition.executed,
            hasOrderResult: Boolean(transition.orderResult),
        });
        return {
            state: {
                ...state,
                step: transition.nextStep,
            },
            outboundText: "Não consegui confirmar o pedido agora. Pode tentar novamente?",
            outcome: "order_create_failed",
        };
    }

    const { orderResult } = transition;
    if (transition.outcome === "order_created_ok") {
        logger?.info("pro_pipeline.order_created_ok", {
            companyId: tenant.companyId,
            threadId: tenant.threadId,
        });
        return {
            state: {
                ...state,
                step: transition.nextStep,
                draft: null,
                misunderstandingStreak: 0,
                escalationTier: 0,
            },
            outboundText: orderResult.customerMessage,
            orderResult,
            outcome: "order_created_ok",
        };
    }

    logger?.warn("pro_pipeline.order_create_failed", {
        companyId: tenant.companyId,
        threadId: tenant.threadId,
        errorCode: orderResult.ok ? undefined : orderResult.errorCode,
        retryable: orderResult.ok ? undefined : orderResult.retryable,
    });
    return {
        state: {
            ...state,
            step: transition.nextStep,
        },
        outboundText: orderResult.customerMessage,
        orderResult,
        outcome: "order_create_failed",
    };
}

