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
    try {
        const webMenu = await resolveActivePublicMenuLink(params.admin, params.companyId, {
            phoneE164: params.phoneE164,
        });
        const { data: botRow } = await params.admin
            .from("chatbots")
            .select("config")
            .eq("company_id", params.companyId)
            .limit(1)
            .maybeSingle();
        const botConfig = (botRow?.config as Record<string, unknown> | null) ?? null;
        const { parseAiOrderModePolicy } = await import("@/lib/chatbot/aiOrderModePolicy");
        const aiOrderModePolicy = parseAiOrderModePolicy(botConfig);
        const deps = makeProPipelineDependencies(params, {
            sessionIdleMinutes: aiOrderModePolicy.sessionIdleMinutes,
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
                flowAddressRegisterId: params.addressRegisterFlowId ?? null,
                webMenuUrl: webMenu?.url ?? null,
                messageTemplates,
                aiOrderModePolicy,
            },
            deps
        );
    } catch (err) {
        logProPipelineFailure(err);
        console.warn("[chatbot/pro] falha do V2 — mensagem fixa ao cliente (sem fallback Starter).");
        await botReply(
            params.admin,
            params.companyId,
            params.threadId,
            params.phoneE164,
            PRO_PIPELINE_FAILURE_MESSAGE_PT_BR
        );
    }
}
