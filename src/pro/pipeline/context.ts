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
}

export const DEFAULT_PRO_POLICIES: PipelinePolicies = {
    locale: "pt-BR",
    maxToolRounds: 12,
    maxHistoryTurns: 24,
    aiTimeoutMs: 15_000,
    escalationRule: {
        unknownConsecutive: 2,
        lowConfidenceConsecutive: 2,
        noProgressTurns: 3,
    },
};

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
        policies: policies ?? DEFAULT_PRO_POLICIES,
        nowIso: input.nowIso,
        flowCatalogId: input.flowCatalogId ?? null,
        flowStatusId: input.flowStatusId ?? null,
    };
}

