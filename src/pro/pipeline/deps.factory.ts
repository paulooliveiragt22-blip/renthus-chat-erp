import type { ProcessMessageParams } from "@/lib/chatbot/types";
import { FullAiServiceAdapter } from "../adapters/ai/ai.service.full";
import { ConsoleLoggerAdapter } from "../adapters/logger/logger.console";
import { ConsoleMetricsAdapter } from "../adapters/metrics/metrics.console";
import { LegacyOrderServiceAdapter } from "../adapters/order/order.service.legacy";
import { SupabaseSessionRepository } from "../adapters/supabase/session.repository.supabase";
import { WhatsAppMessageGateway } from "../adapters/whatsapp/message.gateway.whatsapp";
import { ProIntentClassifierService } from "../services/intent/intent.service";
import type { PipelineDependencies } from "./context";

export function makeProPipelineDependencies(params: ProcessMessageParams): PipelineDependencies {
    return {
        sessionRepo: new SupabaseSessionRepository(params.admin),
        messageGateway: new WhatsAppMessageGateway(params.admin, params.waConfig),
        metrics: new ConsoleMetricsAdapter(),
        logger: new ConsoleLoggerAdapter(),
        intentService: new ProIntentClassifierService(),
        aiService: new FullAiServiceAdapter(params.admin),
        orderService: new LegacyOrderServiceAdapter(params.admin),
    };
}

