/**
 * Contratos V2 - fonte única de verdade para o novo pipeline PRO.
 * Sem campos legados em snake_case.
 */

export type Locale = "pt-BR";
export type ChatbotTier = "starter" | "pro";
export type PaymentMethod = "pix" | "cash" | "card";

export type Intent =
    | "order_intent"
    | "status_intent"
    | "human_intent"
    | "faq"
    | "greeting"
    | "unknown";

export type ProStep =
    | "pro_idle"
    | "pro_collecting_order"
    | "pro_awaiting_confirmation"
    | "pro_escalation_choice"
    | "handover";

export interface TenantRef {
    companyId: string;
    threadId: string;
    messageId: string;
    phoneE164: string;
}

export interface ActorRef {
    channel: "whatsapp";
    source: "meta_webhook" | "internal";
    profileName?: string | null;
}

export interface DraftAddress {
    logradouro: string;
    numero: string;
    bairro: string;
    complemento: string | null;
    apelido?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    enderecoClienteId?: string | null;
    bairroLabel?: string | null;
}

export interface DraftItem {
    produtoEmbalagemId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    fatorConversao: number;
    productVolumeId: string | null;
    estoqueUnidades: number;
}

export interface OrderDraft {
    items: DraftItem[];
    address: DraftAddress | null;
    paymentMethod: PaymentMethod | null;
    changeFor: number | null;
    deliveryFee: number;
    deliveryZoneId: string | null;
    deliveryAddressText: string | null;
    deliveryMinOrder: number | null;
    deliveryEtaMin: number | null;
    totalItems: number;
    grandTotal: number;
    pendingConfirmation: boolean;
    addressResolutionNote?: string | null;
    version: number;
}

export interface AiTurn {
    role: "user" | "assistant";
    content: unknown;
    ts: number;
}

export interface ProSessionState {
    step: ProStep;
    customerId: string | null;
    misunderstandingStreak: number;
    escalationTier: 0 | 1 | 2;
    draft: OrderDraft | null;
    aiHistory: AiTurn[];
}

export interface IntentDecision {
    intent: Intent;
    confidence: "high" | "medium" | "low";
    reasonCode:
        | "button_id_match"
        | "regex_match"
        | "llm_classification"
        | "confirmation_shortcut"
        | "fallback_unknown";
}

export interface OutboundMessage {
    kind: "text" | "buttons" | "flow";
    text?: string;
    buttons?: Array<{ id: string; title: string }>;
    flow?: {
        flowId: string;
        flowToken: string;
        ctaLabel: string;
        bodyText: string;
    };
}

export type SideEffect =
    | { type: "persist_session"; state: ProSessionState }
    | { type: "finalize_order"; input: OrderServiceInput }
    | { type: "handover"; reason: string };

export interface ProPipelineInput {
    tenant: TenantRef;
    actor: ActorRef;
    tier: ChatbotTier;
    inboundText: string;
    nowIso: string;
}

export interface ProPipelineOutput {
    nextState: ProSessionState;
    outbound: OutboundMessage[];
    sideEffects: SideEffect[];
    metrics: Array<{
        name: string;
        value: number;
        tags?: Record<string, string>;
    }>;
}

/** Motivos estáveis para métricas/logs do pipeline PRO (ver `REFACTOR_STRATEGY_PRO_ORDER_AND_IA.md` R0). */
export type ProPipelineTelemetryReason =
    | "draft_validation_failed"
    | "finalize_blocked"
    | "confirmation_ambiguous"
    | "tool_output_rejected"
    | "ai_timeout"
    | "ai_invalid_response"
    | "order_rejected"
    | "invalid_state_transition";

export interface PipelinePolicies {
    locale: Locale;
    maxToolRounds: number;
    maxHistoryTurns: number;
    /** Timeout (ms) da chamada ao modelo no adapter de IA; alinhado a `aiStage`. */
    aiTimeoutMs: number;
    escalationRule: {
        unknownConsecutive: number;
        lowConfidenceConsecutive: number;
        noProgressTurns: number;
    };
}

export interface PipelineContext {
    tenant: TenantRef;
    actor: ActorRef;
    session: ProSessionState;
    policies: PipelinePolicies;
    nowIso: string;
}

export interface AiServiceInput {
    context: PipelineContext;
    userText: string;
    intentDecision: IntentDecision;
    draft: OrderDraft | null;
    history: AiTurn[];
    limits: {
        maxToolRounds: number;
        maxHistoryTurns: number;
        timeoutMs: number;
    };
}

export type AiServiceAction =
    | "reply"
    | "request_clarification"
    | "request_confirmation"
    | "escalate"
    | "error";

export interface AiServiceResult {
    action: AiServiceAction;
    replyText: string;
    updatedDraft?: OrderDraft | null;
    updatedHistory?: AiTurn[];
    signals: {
        toolRoundsUsed: number;
        intentMarker?: "ok" | "unknown" | null;
    };
    errorCode?: "AI_TIMEOUT" | "AI_RATE_LIMIT" | "AI_PROVIDER_ERROR" | "TOOL_FAILED";
}

export interface OrderServiceInput {
    tenant: TenantRef;
    customerId: string;
    draft: OrderDraft;
    idempotencyKey: string;
}

export type OrderServiceResult =
    | {
        ok: true;
        orderId: string;
        customerMessage: string;
        requireApproval: boolean;
    }
    | {
        ok: false;
        customerMessage: string;
        errorCode:
            | "MIN_ORDER_NOT_MET"
            | "DELIVERY_AREA_NOT_SUPPORTED"
            | "OUT_OF_STOCK"
            | "PRODUCT_NOT_FOUND"
            | "INVALID_PAYMENT"
            | "INVALID_ADDRESS"
            | "RPC_ERROR"
            | "DB_ERROR";
        retryable: boolean;
    };

