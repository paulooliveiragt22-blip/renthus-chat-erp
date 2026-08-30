/**
 * Contratos V2 - fonte única de verdade para o novo pipeline PRO.
 * Sem campos legados em snake_case.
 */

export type Locale = "pt-BR";
/** @deprecated Starter removido — motor único PRO. Mantido para tipagem legada de testes. */
export type ChatbotTier = "pro";
export type PaymentMethod = "pix" | "cash" | "card" | "debit";
/** Como o cliente recebe o pedido. `null` = ainda não escolheu. */
export type FulfillmentType = "delivery" | "pickup";

/** Canal de mensagem Meta / WhatsApp (ActorRef + TenantRef). */
export type MessagingChannelRef = "whatsapp" | "instagram" | "messenger";

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
    | "pro_awaiting_phone"
    | "pro_escalation_choice"
    | "handover";

export interface TenantRef {
    companyId: string;
    threadId: string;
    messageId: string;
    /**
     * WhatsApp: E.164. IG/Messenger: vazio até vincular telefone;
     * use `channelUserId` para envio.
     */
    phoneE164: string;
    messagingChannel?: MessagingChannelRef;
    /** IGSID / PSID / E.164 — identidade de envio no canal. */
    channelUserId?: string;
}

export interface ActorRef {
    channel: MessagingChannelRef;
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
    /** `null` até o cliente escolher Entrega ou Retirada. */
    fulfillmentType?: FulfillmentType | null;
    deliveryFee: number;
    deliveryZoneId: string | null;
    deliveryAddressText: string | null;
    deliveryMinOrder: number | null;
    deliveryEtaMin: number | null;
    totalItems: number;
    grandTotal: number;
    pendingConfirmation: boolean;
    addressResolutionNote?: string | null;
    /** Observação do cliente no pedido (resumo). Não por item. */
    orderNotes?: string | null;
    version: number;
}

/**
 * Input normalizado da tool `prepare_order_draft` (wire do modelo pode ser snake_case;
 * `normalizePrepareDraftAnthropicInput` converte uma vez na borda).
 */
export interface PrepareDraftToolInput {
    items: Array<{ produtoEmbalagemId: string; quantity: number | string }>;
    address: {
        logradouro: string;
        numero: string;
        bairro: string;
        complemento?: string | null;
        apelido?: string | null;
        cidade?: string | null;
        estado?: string | null;
        cep?: string | null;
    } | null;
    addressRaw?: string | null;
    savedAddressId?: string | null;
    useSavedAddress?: boolean;
    paymentMethod?: string | null;
    changeFor?: number | null;
    readyForConfirmation?: boolean;
    /** Observação do pedido (texto livre do cliente). Ausente = não alterar. */
    orderNotes?: string | null;
}

export interface AiTurn {
    role: "user" | "assistant";
    content: unknown;
    ts: number;
}

export type PendingPickOption = {
    embalagemId: string;
    displayName: string | null;
    productName: string | null;
    siglaComercial: string | null;
    precoVenda: number | null;
    fatorConversao: number | null;
};

export type PendingPickGroup = {
    /** Chave estável (nome do produto normalizado) — dedup ao reprocessar a mesma busca. */
    productKey: string;
    productLabel: string;
    options: PendingPickOption[];
    /** Turnos consecutivos sem resolução total deste grupo (rede de segurança → botão). */
    unresolvedTurns: number;
};

export interface ProSessionState {
    step: ProStep;
    customerId: string | null;
    misunderstandingStreak: number;
    escalationTier: 0 | 1 | 2;
    draft: OrderDraft | null;
    aiHistory: AiTurn[];
    /**
     * Resumo rolling do histórico antigo (SessionMemoryPort) — injetado no system do LLM.
     */
    aiHistorySummary?: string | null;
    /**
     * Endereço de entrega aceito para checkout.
     * Com rua+número+bairro(+cidade/UF) resolvidos no servidor, fica `true` automaticamente
     * (sem segundo “Confirma este endereço?”). Botões legados ainda podem setar.
     */
    deliveryAddressUiConfirmed?: boolean;
    /**
     * Após Corrigir / Adicionar produtos (ou texto de revisão na confirmação):
     * mantém `pro_collecting_order` mesmo com draft completo, sem reemitir o card de resumo.
     * Limpa quando o draft muda (novo prepare) ou o pedido é cancelado.
     */
    checkoutEditHold?: boolean;
    /**
     * Troca em andamento: ao confirmar pick, remover do draft itens cujo nome casa com este hint
     * (ex.: "salgadinho") antes de acrescentar o SKU novo.
     */
    pendingSwapRemoveName?: string | null;
    /**
     * @deprecated Legado de extract/bootstrap — não gravar no hot path agent-loop.
     * Mantido na sessão só para drain de sessões antigas; prepare usa draft.paymentMethod.
     */
    inferredPaymentMethod?: PaymentMethod | null;
    /**
     * Embalagens resolvidas no bootstrap multi-item (antes das clarificações).
     * O prepare do pick deve reincluir estes IDs para não perder Heineken/burger.
     */
    bootstrapResolvedEmbalagemIds?: string[];
    /**
     * Fila de clarificações ainda pendentes do bootstrap multi-item
     * (ex.: após escolher Heineken, ainda falta perguntar salgadinho UN/CX).
     */
    bootstrapPendingClarifications?: Array<{
        segment: string;
        /** Qty pedida no texto original (extração LLM) para este segmento. */
        quantity?: number;
        /** Conflito com hábito do cliente (legado; texto explícito não conflita). */
        habitConflict?: boolean;
        /** Sigla habitual do cliente neste produto (`siglas_comerciais.sigla`). */
        habit?: string | null;
        picks: Array<{
            embalagemId: string;
            label: string;
            price?: number | null;
            productName?: string | null;
        }>;
    }>;
    /**
     * IDs de embalagem (`view_chat_produtos.id`) devolvidos pelo último `search_produtos` nesta conversa.
     * O motor PRO V2 só aceita `produto_embalagem_id` do `prepare_order_draft` se estiver nesta lista.
     */
    searchProdutoEmbalagemIds: string[];
    /** Últimas opções de search para botões de clarificação (até 3). */
    lastSearchPicks?: Array<{
        embalagemId: string;
        label: string;
        price?: number | null;
        productName?: string | null;
    }>;
    /** Quantidade da clarificação atual (`lastSearchPicks`) vinda do extrator LLM. */
    pendingClarifyQuantity?: number | null;
    /** Segmento de busca da clarificação atual (para telemetria / qty). */
    pendingClarifySegment?: string | null;
    /**
     * Termos que a busca não achou (sem near-miss) — pedir repetir depois da clarificação atual.
     */
    pendingAskRepeatTerms?: string[];
    /** Buscas vazias consecutivas — escala para cardápio web. */
    emptySearchStreak?: number;
    /**
     * Produtos que o cliente mencionou (ex.: "quero skol e original") e que o próprio modelo
     * declarou (campo obrigatório `search_produtos.outros_produtos_pendentes`) ainda não ter
     * buscado/resolvido neste turno. `ai.service.ts` força `search_produtos` para estes no
     * próximo turno antes de fechar via `respond_to_customer` — evita item citado pelo cliente
     * sumir silenciosamente do rascunho.
     */
    pendingOrderMentions?: string[];
    /**
     * Grupos de escolha de embalagem (UN/CX/Fardo) ainda pendentes quando 2+ produtos
     * distintos ficam ambíguos no mesmo turno (ex.: "quero skol e original", ambos com
     * mais de uma embalagem). Resolvidos por texto livre consolidado — ver
     * `src/pro/pipeline/pendingPickGroups.ts`. Cada grupo carrega as opções válidas
     * (allowlist) para não depender de a IA reescrever preço/opções na prosa.
     */
    pendingPickGroups?: PendingPickGroup[];
    /**
     * Pedido acima do limiar da loja: primeira confirmação só “reconhece” o valor alto;
     * a segunda (com este flag true) fecha o pedido.
     */
    highValueAcknowledged?: boolean;
    /** Turnos Anthropic cobrados na janela wall-clock atual (`info_only` + limite > 0). */
    aiTurnCount?: number;
    /** ISO do início da janela de cota de turnos IA. */
    aiWindowStartedAt?: string | null;
    /**
     * 1º checkout IG/Messenger: precisa coletar telefone antes de fechar pedido.
     * `resumeStepAfterPhone` guarda o passo anterior (em geral confirmação).
     */
    needsPhone?: boolean;
    resumeStepAfterPhone?: ProStep | null;
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
        | "active_order_session"
        /** Ambíguo: pula Haiku do classificador; agent loop resolve. */
        | "defer_to_agent";
}

export interface OutboundMessage {
    kind: "text" | "buttons" | "cta_url";
    text?: string;
    buttons?: Array<{ id: string; title: string }>;
    /** Botão Meta `cta_url` — URL fica atrás do botão (não no corpo). */
    ctaUrl?: {
        bodyText: string;
        displayText: string;
        url: string;
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
    /**
     * URL absoluta do cardápio web (`/c/{slug}`) quando `company_menu_profile.is_active`.
     */
    webMenuUrl?: string | null;
    /** URL meus pedidos (wm TTL curto + `?orders=1`). */
    webMenuOrdersUrl?: string | null;
    /** Saudação / entrega / agradecimento (Configurações → Chatbot). */
    messageTemplates?: {
        msg_welcome_returning: string;
        msg_welcome_first: string;
        msg_out_for_delivery: string;
        msg_thank_you: string;
    } | null;
    /**
     * Modo da IA e limites (Configurações → Chatbot).
     * Default implícito: close_orders, idle 120, janela 60, max turns 0 (ilimitado).
     */
    aiOrderModePolicy?: {
        mode: "close_orders" | "info_only";
        sessionIdleMinutes: number;
        aiSessionWindowMinutes: number;
        aiMaxTurnsPerSession: number;
    } | null;
    /**
     * Perfil de capacidade (essencial/basico, pro|market/avancado, ou degradado).
     * Define orçamento de tools/histórico e se o LLM está ligado.
     */
    aiCapability?: {
        tier: "degradado" | "basico" | "avancado";
        maxToolRounds: number;
        maxHistoryTurns: number;
        aiTimeoutMs: number;
        llmEnabled: boolean;
        model: string;
        /**
         * Opcional (decisão mantida na Fase 4, revertendo a sugestão inicial do plano de tornar
         * obrigatório): além de `runProInbound.ts`, `src/pro/replay/runThreadReplay.ts` e testes
         * também constroem este objeto sem `provider` — torná-lo obrigatório exigiria tocar esses
         * arquivos fora do escopo da fase. Ausente = fallback pro env global, sem risco.
         */
        provider?: "anthropic" | "openai" | "ollama" | "groq";
        planKey?: string | null;
    } | null;
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
    | "confirmation_revision"
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
    /** false = perfil degradado: sem LLM no intent nem no aiStage. */
    llmEnabled?: boolean;
    /** Provider/modelo resolvidos por empresa (multi-provider). Ausentes = comportamento atual (env global). */
    aiProvider?: "anthropic" | "openai" | "ollama" | "groq";
    aiModel?: string;
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
    webMenuUrl?: string | null;
    webMenuOrdersUrl?: string | null;
    /** close_orders (default) fecha pedido; info_only só tira dúvidas. */
    aiOrderMode?: "close_orders" | "info_only";
    /**
     * Snapshot do mesmo payload de `get_order_hints`, carregado no servidor antes da IA
     * quando há `order_intent` e `session.customerId` — endereços/favoritos não dependem só da tool.
     */
    prefetchedOrderHints?: Record<string, unknown> | null;
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
    /**
     * Pick de embalagem: primeira chamada ao modelo já força `prepare_order_draft`
     * (evita texto livre + rodada extra de force-prepare).
     */
    preferPrepareToolChoiceFirst?: boolean;
    /** Prepare já rodou no servidor neste turno (pick) — não reabrir force-prepare. */
    skipForcePrepareAfterPick?: boolean;
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
    /** Resumo rolling após compactação (persistir em `ProSessionState.aiHistorySummary`). */
    updatedAiHistorySummary?: string | null;
    /** Atualização da allowlist de catálogo após rodadas de tool (PRO V2). */
    updatedSearchProdutoEmbalagemIds?: string[];
    /** Opções para botões WhatsApp após busca ambígua. */
    lastSearchPicks?: Array<{
        embalagemId: string;
        label: string;
        price?: number | null;
        productName?: string | null;
    }>;
    emptySearchStreak?: number;
    /** Ver `ProSessionState.pendingOrderMentions`. */
    updatedPendingOrderMentions?: string[];
    /** Ver `ProSessionState.pendingPickGroups`. */
    updatedPendingPickGroups?: PendingPickGroup[];
    signals: {
        toolRoundsUsed: number;
        /** Heurística a partir do sufixo da resposta do modelo (não é payload de WhatsApp). */
        intentMarker?: "ok" | "unknown" | null;
        /**
         * Modelo sinalizou (marcador `ADDR_FREE_TEXT`) que respondeu em texto livre sobre
         * endereço porque o cliente questionou/mencionou entrega em endereço diferente.
         * O servidor não sobrepõe com os botões de escolha de endereço neste turno.
         */
        addressFreeText?: boolean;
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
            | "DB_ERROR"
            | "NEEDS_PHONE";
        retryable: boolean;
    };

