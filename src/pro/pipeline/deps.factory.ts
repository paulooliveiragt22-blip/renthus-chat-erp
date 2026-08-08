import type { ProcessMessageParams } from "@/lib/chatbot/types";
import { AiServiceAdapter } from "../adapters/ai/ai.service";
import { LlmSessionMemoryAdapter } from "../adapters/ai/sessionMemory.llm";
import { ConsoleLoggerAdapter } from "../adapters/logger/logger.console";
import { ConsoleMetricsAdapter } from "../adapters/metrics/metrics.console";
import { SupabaseMetricsAdapter } from "../adapters/metrics/metrics.supabase";
import { OrderServiceV2Adapter } from "../adapters/order/order.service.v2";
import { SupabaseCatalogAdapter } from "../adapters/supabase/catalog.supabase";
import { SupabaseOrderDraftAdapter } from "../adapters/supabase/orderDraft.supabase";
import { SupabaseSessionRepository } from "../adapters/supabase/session.repository.supabase";
import { WhatsAppMessageGateway } from "../adapters/whatsapp/message.gateway.whatsapp";
import { MetaMessageGateway } from "../adapters/meta/message.gateway.meta";
import { SupabaseCompanyPolicyAdapter } from "../ports/companyPolicy.port";
import { SupabaseOrderHintsAdapter } from "../ports/orderHints.port";
import { ProIntentClassifierService } from "../services/intent/intent.service";
import type { MetricsPort } from "../ports/metrics.port";
import type { PipelineDependencies } from "./context";
import type { MessageGateway } from "../ports/message.gateway";

/** Permite testes e integrações substituir portas sem alterar `ProcessMessageParams`. */
export type ProPipelineDependencyOverrides = Partial<PipelineDependencies>;

export interface MakeProPipelineDependenciesOptions {
    overrides?: ProPipelineDependencyOverrides;
    /** Idle WhatsApp da sessão (minutos); default 120 no repositório/session. */
    sessionIdleMinutes?: number;
}

function makeMetricsPort(admin: ProcessMessageParams["admin"]): MetricsPort {
    const store = process.env.PRO_PIPELINE_METRICS_STORE?.trim().toLowerCase() ?? "";
    if (store === "supabase") {
        return new SupabaseMetricsAdapter(admin);
    }
    return new ConsoleMetricsAdapter();
}

function makeMessageGateway(params: ProcessMessageParams): MessageGateway {
    const channel = params.messagingChannel ?? "whatsapp";
    if (channel === "instagram" || channel === "messenger") {
        return new MetaMessageGateway(params.admin, channel);
    }
    return new WhatsAppMessageGateway(params.admin, params.waConfig);
}

export function makeProPipelineDependencies(
    params: ProcessMessageParams,
    options?: MakeProPipelineDependenciesOptions
): PipelineDependencies {
    const catalog = new SupabaseCatalogAdapter(params.admin);
    const orderDraft = new SupabaseOrderDraftAdapter(params.admin);
    const sessionMemory = new LlmSessionMemoryAdapter(params.admin, params.companyId);
    const base: PipelineDependencies = {
        sessionRepo: new SupabaseSessionRepository(params.admin, {
            idleMinutes: options?.sessionIdleMinutes,
        }),
        messageGateway: makeMessageGateway(params),
        metrics: makeMetricsPort(params.admin),
        logger: new ConsoleLoggerAdapter(),
        intentService: new ProIntentClassifierService(params.admin),
        aiService: new AiServiceAdapter(params.admin, {
            catalog,
            orderDraft,
            sessionMemory,
        }),
        orderService: new OrderServiceV2Adapter(params.admin),
        companyPolicy: new SupabaseCompanyPolicyAdapter(params.admin),
        orderHints: new SupabaseOrderHintsAdapter(params.admin),
        admin: params.admin,
    };
    return { ...base, ...options?.overrides };
}
