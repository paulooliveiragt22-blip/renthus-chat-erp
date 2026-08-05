/**
 * lib/chatbot/processMessage.ts
 *
 * Ponto de entrada do chatbot WhatsApp.
 * Resolve o **nível do motor** pelo plano da empresa (Starter vs PRO) e delega o pipeline.
 *
 * - **Starter**: `runInboundChatbotPipeline` (flow-first / catálogo).
 * - **PRO**: sempre `runProInbound` → `runProPipeline` (`src/pro/`). Falha → mensagem fixa PT-BR.
 */

export type { ProcessMessageParams } from "./types";
export type { CartItem, Session } from "./types";

import type { ProcessMessageParams } from "./types";
import type { ChatbotProductTier } from "./tier";
import { getChatbotProductTier } from "./tier";
import { runInboundChatbotPipeline } from "./inboundPipeline";
import { runProInbound } from "./runProInbound";

/** Só testes (`npm test` / tsx). Ignorado em production. */
function resolveTierOverride(): ChatbotProductTier | null {
    if (process.env.NODE_ENV === "production") return null;
    const v = (process.env.CHATBOT_TEST_FORCE_TIER ?? "").trim().toLowerCase();
    if (v === "pro" || v === "starter") return v;
    return null;
}

export async function processInboundMessage(params: ProcessMessageParams): Promise<void> {
    const { data: botRow } = await params.admin
        .from("chatbots")
        .select("config")
        .eq("company_id", params.companyId)
        .limit(1)
        .maybeSingle();
    const botConfig = (botRow?.config as Record<string, unknown> | null) ?? null;
    const tier =
        resolveTierOverride() ??
        (await getChatbotProductTier(params.admin, params.companyId, botConfig));

    if (tier === "pro") {
        await runProInbound(params);
        return;
    }

    await runInboundChatbotPipeline(params, tier);
}
