import type { ProcessMessageParams } from "@/lib/chatbot/types";
import { FullAiServiceAdapter } from "../adapters/ai/ai.service.full";
import { ConsoleLoggerAdapter } from "../adapters/logger/logger.console";
import { ConsoleMetricsAdapter } from "../adapters/metrics/metrics.console";
import { OrderServiceV2Adapter } from "../adapters/order/order.service.v2";
import { SupabaseSessionRepository } from "../adapters/supabase/session.repository.supabase";
import { WhatsAppMessageGateway } from "../adapters/whatsapp/message.gateway.whatsapp";
import { ProIntentClassifierService } from "../services/intent/intent.service";
import type { PipelineDependencies } from "./context";

/** Permite testes e integrações substituir portas sem alterar `ProcessMessageParams`. */
export type ProPipelineDependencyOverrides = Partial<PipelineDependencies>;

export interface MakeProPipelineDependenciesOptions {
    overrides?: ProPipelineDependencyOverrides;
}

export function makeProPipelineDependencies(
    params: ProcessMessageParams,
    options?: MakeProPipelineDependenciesOptions
): PipelineDependencies {
    const base: PipelineDependencies = {
        sessionRepo: new SupabaseSessionRepository(params.admin),
        messageGateway: new WhatsAppMessageGateway(params.admin, params.waConfig),
        metrics: new ConsoleMetricsAdapter(),
        logger: new ConsoleLoggerAdapter(),
        intentService: new ProIntentClassifierService(),
        aiService: new FullAiServiceAdapter(params.admin),
        orderService: new OrderServiceV2Adapter(params.admin),
    };
    return { ...base, ...options?.overrides };
}

