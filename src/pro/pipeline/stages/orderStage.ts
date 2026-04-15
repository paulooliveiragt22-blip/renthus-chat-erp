import type {
    IntentDecision,
    OrderServiceResult,
    ProSessionState,
    TenantRef,
} from "@/src/types/contracts";
import type { OrderService } from "../../services/order/order.types";

export interface OrderStageResult {
    state: ProSessionState;
    outboundText?: string;
    orderResult?: OrderServiceResult;
}

function isExplicitConfirmation(text: string): boolean {
    return /^(sim|ok|confirmo|pode\s+fechar|fechar)\b/iu.test(text.trim());
}

export async function orderStage(params: {
    orderService: OrderService;
    tenant: TenantRef;
    state: ProSessionState;
    decision: IntentDecision;
    userText: string;
}): Promise<OrderStageResult> {
    const { orderService, tenant, state, userText } = params;

    if (state.step !== "pro_awaiting_confirmation") return { state };
    if (!isExplicitConfirmation(userText)) return { state };
    if (!state.draft || !state.customerId) {
        return {
            state: { ...state, step: "pro_collecting_order" },
            outboundText: "Não encontrei um rascunho de pedido para confirmar. Me diga os itens novamente.",
        };
    }

    const hasItems = state.draft.items.length > 0;
    const hasAddress = Boolean(state.draft.address);
    const hasPayment = Boolean(state.draft.paymentMethod);
    if (!hasItems || !hasAddress || !hasPayment) {
        return {
            state: { ...state, step: "pro_collecting_order" },
            outboundText: "Seu pedido ainda está incompleto. Vamos revisar itens, endereço e pagamento antes de confirmar.",
        };
    }

    const orderResult = await orderService.createFromDraft({
        tenant,
        customerId: state.customerId,
        draft: state.draft,
        idempotencyKey: `${tenant.companyId}:${tenant.threadId}:${tenant.messageId}`,
    });

    if (orderResult.ok) {
        return {
            state: {
                ...state,
                step: "pro_idle",
                draft: null,
                misunderstandingStreak: 0,
                escalationTier: 0,
            },
            outboundText: orderResult.customerMessage,
            orderResult,
        };
    }

    return {
        state: {
            ...state,
            step: "pro_collecting_order",
        },
        outboundText: orderResult.customerMessage,
        orderResult,
    };
}

