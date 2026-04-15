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
import { runProPipeline } from "@/src/pro/pipeline/runProPipeline";
import { makeProPipelineDependencies } from "@/src/pro/pipeline/deps.factory";

export async function processInboundMessage(params: ProcessMessageParams): Promise<void> {
    const tier = await getChatbotProductTier(params.admin, params.companyId);

    const proV2Enabled = process.env.CHATBOT_PRO_PIPELINE_V2 === "1";
    const proV2Mode = (process.env.CHATBOT_PRO_PIPELINE_V2_MODE ?? "shadow").toLowerCase();
    const proV2Active = proV2Mode === "active";

    if (tier === "pro" && proV2Enabled) {
        try {
            const deps = makeProPipelineDependencies(params);
            await runProPipeline(
                {
                    tenant: {
                        companyId: params.companyId,
                        threadId: params.threadId,
                        messageId: params.messageId,
                        phoneE164: params.phoneE164,
                    },
                    actor: {
                        channel: "whatsapp",
                        source: "internal",
                        profileName: params.profileName ?? null,
                    },
                    tier: "pro",
                    inboundText: params.text,
                    nowIso: new Date().toISOString(),
                },
                deps
            );

            if (proV2Active) return;
            console.info("[chatbot/pro-v2] shadow run concluído, seguindo pipeline legado.");
        } catch (err) {
            console.error("[chatbot/pro-v2] erro no pipeline novo:", err);
            if (proV2Active) {
                console.warn("[chatbot/pro-v2] fallback automático para pipeline legado.");
            }
        }
    }

    await runInboundChatbotPipeline(params, tier);
}
