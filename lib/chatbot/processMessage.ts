/**
 * lib/chatbot/processMessage.ts
 *
 * Ponto de entrada do chatbot WhatsApp.
 * Resolve o **nível do motor** pelo plano da empresa (Starter vs PRO) e delega o pipeline.
 *
 * - **Chatbot Starter** (`plans.key = starter`): fluxo actual flow-first (catálogo via Flow).
 * - **Chatbot PRO** (`plans.key = pro`): IA com tool `search_produtos` + Flow após falhas de interpretação.
 */

export type { ProcessMessageParams } from "./types";
export type { CartItem, Session } from "./types";

import type { ProcessMessageParams } from "./types";
import { getChatbotProductTier } from "./tier";
import { runInboundChatbotPipeline } from "./inboundPipeline";

export async function processInboundMessage(params: ProcessMessageParams): Promise<void> {
    const tier = await getChatbotProductTier(params.admin, params.companyId);
    await runInboundChatbotPipeline(params, tier);
}
