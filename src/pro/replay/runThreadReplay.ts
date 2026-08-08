import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, ProSessionState } from "@/src/types/contracts";
import type { LoggerPort } from "@/src/pro/ports/logger.port";
import type { MessageGateway } from "@/src/pro/ports/message.gateway";
import type { MetricsPort } from "@/src/pro/ports/metrics.port";
import type { SessionRepository } from "@/src/pro/ports/session.repository";
import type { AiService } from "@/src/pro/services/ai/ai.types";
import type { IntentService } from "@/src/pro/services/intent/intent.types";
import type { OrderService } from "@/src/pro/services/order/order.types";
import { runProPipeline } from "@/src/pro/pipeline/runProPipeline";
import {
    loadThreadMessagesForReplay,
    loadThreadTracesForReplay,
} from "@/src/pro/replay/loadThreadForReplay";
import { compareOutbound } from "@/src/pro/replay/compareOutbound";
import { AiServiceAdapter } from "@/src/pro/adapters/ai/ai.service";

export type ReplayTurnResult = {
    inboundMessageId: string;
    inboundText: string;
    outbound: Array<{ kind: string; text?: string }>;
    stepAfter: string;
    diffVsTrace: ReturnType<typeof compareOutbound> | null;
};

function idleState(): ProSessionState {
    return {
        step: "pro_idle",
        customerId: null,
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
    };
}

function stubIntent(): IntentService {
    return {
        classify: async ({ userText }) => {
            const t = String(userText ?? "").toLowerCase();
            if (/\b(oi|olá|ola|bom dia|boa tarde)\b/.test(t)) {
                return {
                    intent: "greeting",
                    confidence: "high",
                    reasonCode: "regex_match",
                };
            }
            if (/\b(atendente|humano|ajuda)\b/.test(t)) {
                return {
                    intent: "human_intent",
                    confidence: "high",
                    reasonCode: "regex_match",
                };
            }
            return {
                intent: "order_intent",
                confidence: "medium",
                reasonCode: "fallback_unknown",
            };
        },
    };
}

/**
 * Reprocessa inbound da thread sem enviar Meta / sem criar pedido real.
 * `useAi=false` (default): AI stub (não chama LLM real, sem custo).
 * `useAi=true`: `AiServiceAdapter` real (Vercel AI SDK) — chama o provider configurado.
 *
 * Cassete determinístico (fixture de respostas do LLM) foi descontinuado nesta migração
 * (`FullAiServiceAdapter`/`ReplayLlmPort` deletados na Fase 3, ver
 * docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md) — replanejar na Fase 7 se necessário.
 */
export async function runThreadReplay(params: {
    admin: SupabaseClient;
    companyId: string;
    threadId: string;
    useAi?: boolean;
    phoneE164?: string;
    channel?: "whatsapp" | "instagram" | "messenger";
}): Promise<{ turns: ReplayTurnResult[]; summary: { turns: number; diffs: number } }> {
    const messages = await loadThreadMessagesForReplay(params.admin, {
        companyId: params.companyId,
        threadId: params.threadId,
    });
    const inbound = messages.filter((m) => m.direction === "inbound" || m.direction === "in");

    let traces: Awaited<ReturnType<typeof loadThreadTracesForReplay>> = [];
    try {
        traces = await loadThreadTracesForReplay(params.admin, {
            companyId: params.companyId,
            threadId: params.threadId,
        });
    } catch {
        traces = [];
    }
    const traceByInbound = new Map(
        traces.map((t) => [t.inbound_message_id, t] as const)
    );

    let state = idleState();
    const logger: LoggerPort = {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    };
    const metrics: MetricsPort = {
        increment: () => undefined,
        timing: () => undefined,
    };
    const sessionRepo: SessionRepository = {
        load: async () => state,
        save: async (_c, _t, next) => {
            state = next;
        },
    };

    const collected: OutboundMessage[] = [];
    const messageGateway: MessageGateway = {
        send: async (_tenant, message) => {
            collected.push(message);
        },
    };

    const intentService = stubIntent();

    const aiService: AiService = params.useAi
        ? new AiServiceAdapter(params.admin)
        : {
              run: async () =>
                  ({
                      action: "reply",
                      replyText: "",
                      signals: { toolRoundsUsed: 0 },
                  }) as never,
          };

    const orderService: OrderService = {
        createFromDraft: async () => ({
            ok: false,
            customerMessage: "[replay] pedido não criado (dry-run)",
            errorCode: "RPC_ERROR",
            retryable: false,
        }),
    };

    const channel = params.channel ?? "whatsapp";
    const phone = params.phoneE164 ?? "";
    const turns: ReplayTurnResult[] = [];
    let diffs = 0;

    for (const msg of inbound) {
        collected.length = 0;
        const text = (msg.body ?? "").trim();
        const inboundMessageId = msg.provider_message_id?.trim() || msg.id;

        await runProPipeline(
            {
                tenant: {
                    companyId: params.companyId,
                    threadId: params.threadId,
                    messageId: inboundMessageId,
                    phoneE164: phone,
                    messagingChannel: channel,
                    channelUserId: phone || undefined,
                },
                actor: {
                    channel,
                    source: "meta_webhook",
                    profileName: null,
                },
                tier: "pro",
                inboundText: text,
                nowIso: msg.created_at || new Date().toISOString(),
                aiCapability: {
                    tier: "avancado",
                    maxToolRounds: params.useAi ? 8 : 0,
                    maxHistoryTurns: 12,
                    aiTimeoutMs: 5_000,
                    llmEnabled: Boolean(params.useAi),
                    model: "replay",
                    planKey: "market",
                },
            },
            {
                sessionRepo,
                messageGateway,
                metrics,
                logger,
                intentService,
                aiService,
                orderService,
                admin: params.admin,
            }
        );

        const outbound = collected.map((m) => ({
            kind: m.kind,
            text:
                m.kind === "text"
                    ? m.text
                    : m.kind === "flow"
                      ? m.flow?.bodyText
                      : m.text || (m.buttons ?? []).map((b) => b.title).join(" | "),
        }));

        const trace = traceByInbound.get(inboundMessageId);
        const expected = Array.isArray(trace?.outbound)
            ? (trace!.outbound as Array<{ kind?: string; text?: string }>)
            : null;
        const diffVsTrace = expected ? compareOutbound(expected, outbound) : null;
        if (diffVsTrace && !diffVsTrace.equal) diffs += 1;

        turns.push({
            inboundMessageId,
            inboundText: text.slice(0, 200),
            outbound,
            stepAfter: state.step,
            diffVsTrace,
        });
    }

    return {
        turns,
        summary: { turns: turns.length, diffs },
    };
}
