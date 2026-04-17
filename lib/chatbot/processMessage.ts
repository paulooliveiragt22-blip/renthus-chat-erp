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
import type { ChatbotProductTier } from "./tier";
import { getChatbotProductTier } from "./tier";
import { runInboundChatbotPipeline } from "./inboundPipeline";
import { botReply } from "./botSend";
import { runProPipeline } from "@/src/pro/pipeline/runProPipeline";
import { isProPipelineSessionLoadError } from "@/src/pro/pipeline/errors";
import { makeProPipelineDependencies } from "@/src/pro/pipeline/deps.factory";

/** Modo `active`: falha do V2 não delega pedido ao legado (evita `ai_order_canonical` vs `__pro_v2_state`). */
const PRO_V2_ACTIVE_FAILURE_MESSAGE_PT_BR =
    "Não consegui processar seu pedido agora por um problema técnico.\n\n" +
    "Tente enviar sua mensagem de novo em alguns instantes. " +
    "Se precisar falar com uma pessoa, digite *atendente* ou *humano*.";

let proV2ShadowModeWarned = false;
let proV2ProdShadowErrorLogged = false;

function logProV2PipelineFailure(err: unknown): void {
    if (isProPipelineSessionLoadError(err)) {
        const c = err.underlyingCause;
        console.error("[chatbot/pro-v2] erro ao carregar sessão PRO:", {
            code: err.code,
            companyId: err.tenant.companyId,
            threadId: err.tenant.threadId,
            cause: c instanceof Error ? c.message : c,
        });
        return;
    }
    console.error("[chatbot/pro-v2] erro no pipeline novo:", err);
}

function warnProV2ShadowModeIfNeeded(
    tier: ChatbotProductTier,
    proV2Enabled: boolean,
    proV2Active: boolean
): void {
    if (tier !== "pro" || !proV2Enabled || proV2Active) return;

    if (process.env.NODE_ENV === "production") {
        if (!proV2ProdShadowErrorLogged) {
            proV2ProdShadowErrorLogged = true;
            console.error(
                "[chatbot/pro-v2] PRODUÇÃO com CHATBOT_PRO_PIPELINE_V2_MODE≠active: custo duplicado, latência e risco de estado/resposta divergentes. Defina CHATBOT_PRO_PIPELINE_V2_MODE=active."
            );
        }
        return;
    }

    if (!proV2ShadowModeWarned) {
        proV2ShadowModeWarned = true;
        console.info(
            "[chatbot/pro-v2] CHATBOT_PRO_PIPELINE_V2=1 com modo shadow: o V2 corre mas a resposta visível pode vir do legado (sem quick replies do V2). Em produção use CHATBOT_PRO_PIPELINE_V2_MODE=active."
        );
    }
}

/** @returns `true` se o processamento desta mensagem termina aqui (sem legado). */
async function runProV2InboundBranch(
    params: ProcessMessageParams,
    proV2Active: boolean
): Promise<boolean> {
    try {
        const deps = makeProPipelineDependencies(
            params,
            params.proPipelineDependencyOverrides
                ? { overrides: params.proPipelineDependencyOverrides }
                : undefined
        );
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
                flowCatalogId: params.catalogFlowId ?? null,
                flowStatusId: params.statusFlowId ?? null,
            },
            deps
        );

        if (proV2Active) return true;
        console.info("[chatbot/pro-v2] shadow run concluído, seguindo pipeline legado.");
        return false;
    } catch (err) {
        logProV2PipelineFailure(err);
        if (!proV2Active) return false;

        console.warn(
            "[chatbot/pro-v2] modo active: falha do V2 — pedido no legado bloqueado; mensagem fixa ao cliente."
        );
        await botReply(
            params.admin,
            params.companyId,
            params.threadId,
            params.phoneE164,
            PRO_V2_ACTIVE_FAILURE_MESSAGE_PT_BR
        );
        return true;
    }
}

export async function processInboundMessage(params: ProcessMessageParams): Promise<void> {
    const tier = await getChatbotProductTier(params.admin, params.companyId);

    const proV2Enabled = process.env.CHATBOT_PRO_PIPELINE_V2 === "1";
    const proV2Mode = (process.env.CHATBOT_PRO_PIPELINE_V2_MODE ?? "shadow").toLowerCase();
    const proV2Active = proV2Mode === "active";

    warnProV2ShadowModeIfNeeded(tier, proV2Enabled, proV2Active);

    if (tier === "pro" && proV2Enabled) {
        const finished = await runProV2InboundBranch(params, proV2Active);
        if (finished) return;
    }

    await runInboundChatbotPipeline(params, tier);
}
