/**
 * Entrada do motor PRO (`runProPipeline`). Separado para testes poderem mockar via require.cache.
 */

import type { ProcessMessageParams } from "./types";
import { botReply } from "./botSend";
import { runProPipeline } from "@/src/pro/pipeline/runProPipeline";
import { resolveChatbotMessageTemplates } from "@/lib/chatbot/messageTemplates";
import { isProPipelineSessionLoadError } from "@/src/pro/pipeline/errors";
import { makeProPipelineDependencies } from "@/src/pro/pipeline/deps.factory";
import { resolveActivePublicMenuLink } from "@/lib/public-menu/resolveActiveMenuLink";
import { MetaMessageGateway } from "@/src/pro/adapters/meta/message.gateway.meta";
import { isQueueRetryableError } from "@/lib/chatbot/queueRetry";

const PRO_PIPELINE_FAILURE_MESSAGE_PT_BR =
    "Não consegui processar seu pedido agora por um problema técnico.\n\n" +
    "Tente enviar sua mensagem de novo em alguns instantes. " +
    "Se precisar falar com uma pessoa, digite *atendente* ou *humano*.";

function logProPipelineFailure(err: unknown): void {
    if (isProPipelineSessionLoadError(err)) {
        const c = err.underlyingCause;
        console.error("[chatbot/pro] erro ao carregar sessão PRO:", {
            code: err.code,
            companyId: err.tenant.companyId,
            threadId: err.tenant.threadId,
            cause: c instanceof Error ? c.message : c,
        });
        return;
    }
    console.error("[chatbot/pro] erro no pipeline:", err);
}

export async function runProInbound(params: ProcessMessageParams): Promise<void> {
    const messagingChannel = params.messagingChannel ?? "whatsapp";
    const channelUserId = (params.channelUserId || params.phoneE164 || "").trim();

    try {
        const identityOpts = {
            phoneE164: params.phoneE164 || null,
            identity:
                channelUserId
                    ? { channel: messagingChannel, externalId: channelUserId }
                    : null,
            utmSource: messagingChannel === "whatsapp" ? "whatsapp" : messagingChannel,
        };
        const [webMenu, webMenuOrders] = await Promise.all([
            resolveActivePublicMenuLink(params.admin, params.companyId, identityOpts),
            resolveActivePublicMenuLink(params.admin, params.companyId, {
                ...identityOpts,
                purpose: "orders",
            }),
        ]);
        const [{ data: botRow }, { data: companySettingsRow }] = await Promise.all([
            params.admin
                .from("chatbots")
                .select("config")
                .eq("company_id", params.companyId)
                .limit(1)
                .maybeSingle(),
            params.admin
                .from("company_settings")
                .select("llm_provider")
                .eq("company_id", params.companyId)
                .maybeSingle(),
        ]);
        const botConfig = (botRow?.config as Record<string, unknown> | null) ?? null;
        const companyLlmProvider = (companySettingsRow?.llm_provider as string | null) ?? null;
        const { parseAiOrderModePolicy } = await import("@/lib/chatbot/aiOrderModePolicy");
        const { resolveAiCapabilityProfile } = await import("@/lib/chatbot/aiCapabilityProfile");
        const aiOrderModePolicy = parseAiOrderModePolicy(botConfig);
        const aiCapability = await resolveAiCapabilityProfile(
            params.admin,
            params.companyId,
            botConfig,
            companyLlmProvider
        );
        const deps = makeProPipelineDependencies(params, {
            sessionIdleMinutes: aiOrderModePolicy.sessionIdleMinutes,
            aiCapability: { provider: aiCapability.provider, model: aiCapability.model },
            ...(params.proPipelineDependencyOverrides
                ? { overrides: params.proPipelineDependencyOverrides }
                : {}),
        });
        const messageTemplates = resolveChatbotMessageTemplates(botConfig);
        await runProPipeline(
            {
                tenant: {
                    companyId: params.companyId,
                    threadId: params.threadId,
                    messageId: params.messageId,
                    phoneE164: params.phoneE164 || "",
                    messagingChannel,
                    channelUserId: channelUserId || undefined,
                },
                actor: {
                    channel: messagingChannel,
                    source: messagingChannel === "whatsapp" ? "internal" : "meta_webhook",
                    profileName: params.profileName ?? null,
                },
                tier: "pro",
                inboundText: params.text,
                nowIso: new Date().toISOString(),
                webMenuUrl: webMenu?.url ?? null,
                webMenuOrdersUrl: webMenuOrders?.url ?? null,
                messageTemplates,
                aiOrderModePolicy,
                aiCapability: {
                    tier: aiCapability.tier,
                    maxToolRounds: aiCapability.maxToolRounds,
                    maxHistoryTurns: aiCapability.maxHistoryTurns,
                    aiTimeoutMs: aiCapability.aiTimeoutMs,
                    llmEnabled: aiCapability.llmEnabled,
                    model: aiCapability.model,
                    provider: aiCapability.provider,
                    planKey: aiCapability.planKey,
                    degradedReason: aiCapability.degradedReason ?? null,
                },
            },
            deps
        );
    } catch (err) {
        /** Rate limit / retryable: propaga para a fila (backoff). Não manda bolha genérica. */
        if (isQueueRetryableError(err)) {
            throw err;
        }
        logProPipelineFailure(err);
        console.warn("[chatbot/pro] falha do V2 — mensagem fixa ao cliente (sem fallback Starter).");
        if (messagingChannel === "instagram" || messagingChannel === "messenger") {
            const gw = new MetaMessageGateway(params.admin, messagingChannel);
            await gw.send(
                {
                    companyId: params.companyId,
                    threadId: params.threadId,
                    messageId: params.messageId,
                    phoneE164: params.phoneE164 || "",
                    messagingChannel,
                    channelUserId: channelUserId || undefined,
                },
                { kind: "text", text: PRO_PIPELINE_FAILURE_MESSAGE_PT_BR }
            );
            return;
        }
        await botReply(
            params.admin,
            params.companyId,
            params.threadId,
            params.phoneE164,
            PRO_PIPELINE_FAILURE_MESSAGE_PT_BR
        );
    }
}
