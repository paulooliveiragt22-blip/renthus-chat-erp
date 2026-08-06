import type { SupabaseClient } from "@supabase/supabase-js";
import type { PipelineContext, PipelinePolicies, ProPipelineInput, ProSessionState } from "@/src/types/contracts";
import type { LoggerPort } from "../ports/logger.port";
import type { MessageGateway } from "../ports/message.gateway";
import type { MetricsPort } from "../ports/metrics.port";
import type { SessionRepository } from "../ports/session.repository";
import type { AiService } from "../services/ai/ai.types";
import type { IntentService } from "../services/intent/intent.types";
import type { OrderService } from "../services/order/order.types";

export interface PipelineDependencies {
    sessionRepo: SessionRepository;
    messageGateway: MessageGateway;
    metrics: MetricsPort;
    logger: LoggerPort;
    intentService: IntentService;
    aiService: AiService;
    orderService: OrderService;
    /** Service role Supabase: sincroniza `customerId` da sessão com o telefone WhatsApp. */
    admin?: SupabaseClient;
}

export const DEFAULT_PRO_POLICIES: PipelinePolicies = {
    locale: "pt-BR",
    maxToolRounds: 12,
    maxHistoryTurns: 24,
    aiTimeoutMs: 15_000,
    llmEnabled: true,
    escalationRule: {
        /** Dois `INTENT_UNKNOWN` seguidos escalavam cedo demais (ex.: produto válido após busca). */
        unknownConsecutive: 3,
        lowConfidenceConsecutive: 2,
        noProgressTurns: 3,
    },
};

export function policiesFromAiCapability(
    capability: ProPipelineInput["aiCapability"]
): PipelinePolicies {
    if (!capability || !capability.llmEnabled || capability.tier === "degradado") {
        return {
            ...DEFAULT_PRO_POLICIES,
            maxToolRounds: 0,
            maxHistoryTurns: 0,
            llmEnabled: false,
        };
    }
    return {
        ...DEFAULT_PRO_POLICIES,
        maxToolRounds: capability.maxToolRounds,
        maxHistoryTurns: capability.maxHistoryTurns,
        aiTimeoutMs: capability.aiTimeoutMs,
        llmEnabled: true,
    };
}

export function buildPipelineContext(params: {
    input: ProPipelineInput;
    session: ProSessionState;
    policies?: PipelinePolicies;
}): PipelineContext {
    const { input, session, policies } = params;
    return {
        tenant: input.tenant,
        actor: input.actor,
        session,
        policies: policies ?? policiesFromAiCapability(input.aiCapability) ?? DEFAULT_PRO_POLICIES,
        nowIso: input.nowIso,
        flowCatalogId: input.flowCatalogId ?? null,
        flowStatusId: input.flowStatusId ?? null,
        flowAddressRegisterId: input.flowAddressRegisterId ?? null,
        webMenuUrl: input.webMenuUrl ?? null,
        aiOrderMode:
            input.aiCapability?.tier === "degradado" ||
            input.aiCapability?.llmEnabled === false ||
            input.aiOrderModePolicy?.mode === "info_only"
                ? "info_only"
                : "close_orders",
    };
}

