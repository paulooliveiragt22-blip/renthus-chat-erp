import type { ProcessMessageParams } from "@/lib/chatbot/types";
import { AiServiceAdapter } from "../adapters/ai/ai.service";
import { LlmSessionMemoryAdapter } from "../adapters/ai/sessionMemory.llm";
import type { LlmProviderName } from "../adapters/ai/modelProvider";
import type { CircuitStateChangeEvent } from "@/lib/chatbot/llmResilience";
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
    /** Provider/modelo resolvidos por empresa (ver `aiCapabilityProfile.ts`). Ausente = env global. */
    aiCapability?: { provider?: LlmProviderName; model?: string };
}

function makeMetricsPort(admin: ProcessMessageParams["admin"]): MetricsPort {
    const store = process.env.PRO_PIPELINE_METRICS_STORE?.trim().toLowerCase() ?? "";
    if (store === "supabase") {
        return new SupabaseMetricsAdapter(admin);
    }
    return new ConsoleMetricsAdapter();
}

/** Exportado para HITL (`resolvePendingOrderConfirmation`) e testes — mesmo store do pipeline. */
export { makeMetricsPort };
/**
 * Extraída pra ser testável sem precisar simular o loop inteiro de `generateText`/429 (ver
 * docs/PLANO_MULTI_PROVIDER_IA.md, Fase 9 — pendência trazida da Fase 7).
 */
export function applyCircuitStateChangeToMetrics(
    metrics: MetricsPort,
    event: CircuitStateChangeEvent,
    companyId: string
): void {
    metrics.increment(`pro_pipeline.llm_circuit_${event.state}`, 1, {
        provider: event.provider,
        companyId,
    });
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
    const aiCapability = options?.aiCapability;
    const metrics = makeMetricsPort(params.admin);
    const sessionMemory = new LlmSessionMemoryAdapter(
        params.admin,
        params.companyId,
        undefined, // modelOverride: seam de teste, não usado em produção
        aiCapability?.provider,
        aiCapability?.model
    );
    const onCircuitStateChange = (e: CircuitStateChangeEvent) =>
        applyCircuitStateChangeToMetrics(metrics, e, params.companyId);
    const base: PipelineDependencies = {
        sessionRepo: new SupabaseSessionRepository(params.admin, {
            idleMinutes: options?.sessionIdleMinutes,
        }),
        messageGateway: makeMessageGateway(params),
        metrics,
        logger: new ConsoleLoggerAdapter(),
        intentService: new ProIntentClassifierService(params.admin),
        aiService: new AiServiceAdapter(params.admin, {
            catalog,
            orderDraft,
            sessionMemory,
            providerOverride: aiCapability?.provider,
            modelNameOverride: aiCapability?.model,
            onCircuitStateChange,
            metrics,
        }),
        orderService: new OrderServiceV2Adapter(params.admin),
        companyPolicy: new SupabaseCompanyPolicyAdapter(params.admin),
        orderHints: new SupabaseOrderHintsAdapter(params.admin),
        admin: params.admin,
    };
    return { ...base, ...options?.overrides };
}
