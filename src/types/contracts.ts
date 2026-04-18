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
    | "pro_awaiting_address_confirmation"
    | "pro_awaiting_payment_method"
    | "pro_awaiting_change_amount"
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
    /**
     * IDs de embalagem (`view_chat_produtos.id`) devolvidos pelo último `search_produtos` nesta conversa.
     * O motor PRO V2 só aceita `produto_embalagem_id` do `prepare_order_draft` se estiver nesta lista.
     */
    searchProdutoEmbalagemIds: string[];
}

export interface IntentDecision {
    intent: Intent;
    confidence: "high" | "medium" | "low";
    reasonCode:
        | "button_id_match"
        | "regex_match"
        | "llm_classification"
        | "confirmation_shortcut"
        | "fallback_unknown"
        | "active_order_session";
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
    /** WhatsApp Flow do catálogo (por canal em `provider_metadata.catalog_flow_id` ou env). */
    flowCatalogId?: string | null;
    /** WhatsApp Flow de status de pedido (por canal em `provider_metadata.status_flow_id` ou env). */
    flowStatusId?: string | null;
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

/**
 * Motivos estáveis para `tags.reason` em métricas `pro_pipeline.*` (§6 da estratégia: **&lt; 10** valores).
 * Rejeições internas de `canTransition` usam código à parte (`invalid_state_transition` em `proStepTransitions.ts`), não este tipo.
 */
export type ProPipelineTelemetryReason =
    | "draft_validation_failed"
    | "finalize_blocked"
    | "confirmation_ambiguous"
    | "tool_output_rejected"
    | "ai_timeout"
    | "ai_rate_limited"
    | "ai_provider_error"
    | "ai_invalid_response"
    | "order_rejected";

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
    flowCatalogId?: string | null;
    flowStatusId?: string | null;
}

/** Telemetria por invocação da tool `prepare_order_draft` (adapter PRO IA). */
export type PrepareDraftToolTelemetryPayload = {
    companyId: string;
    threadId: string;
    ok: boolean;
    errors: readonly string[];
    hasItems: boolean;
    hasAddress: boolean;
    payment_method: string | null;
    draftItemCount: number;
};

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
    /** Quando definido (ex.: pipeline PRO), chamado após cada `prepare_order_draft` no servidor. */
    onPrepareDraftToolResult?: (payload: PrepareDraftToolTelemetryPayload) => void;
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
    /** Atualização da allowlist de catálogo após rodadas de tool (PRO V2). */
    updatedSearchProdutoEmbalagemIds?: string[];
    signals: {
        toolRoundsUsed: number;
        /** Heurística a partir do sufixo da resposta do modelo (não é payload de WhatsApp). */
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
            | "INCONSISTENT_DRAFT"
            | "RPC_ERROR"
            | "DB_ERROR";
        retryable: boolean;
    };

