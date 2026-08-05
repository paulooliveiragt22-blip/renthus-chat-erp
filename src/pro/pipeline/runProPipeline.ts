import type {
    OutboundMessage,
    PipelineContext,
    ProPipelineInput,
    ProPipelineOutput,
    ProPipelineTelemetryReason,
    ProSessionState,
} from "@/src/types/contracts";
import { buildOrderHintsPayload } from "@/lib/chatbot/pro/orderHints";
import {
    buildAiLimitExceededOutbound,
    buildInfoOnlyOrderBlockedText,
    bumpAiTurnCount,
    isAiTurnLimitExceeded,
    isInfoOnlyMode,
    parseAiOrderModePolicy,
    type AiOrderModePolicy,
} from "@/lib/chatbot/aiOrderModePolicy";
import type { LoggerPort } from "../ports/logger.port";
import { buildPipelineContext, type PipelineDependencies } from "./context";
import type { MetricsPort } from "../ports/metrics.port";
import { aiStage } from "./stages/aiStage";
import { guardRails } from "./stages/guardRails";
import { intentStage } from "./stages/intentStage";
import { loadState } from "./stages/loadState";
import { orderStage } from "./stages/orderStage";
import { persistAndEmit } from "./stages/persistAndEmit";
import { routeStage } from "./stages/routeStage";
import {
    applyProductPickFromButton,
    applyQuickAction,
    checkoutPostProcess,
    checkoutPostProcessForQuickAction,
    strictCheckoutStructuredGate,
    type FlowAddressRegisterQuickOpts,
} from "./stages/checkoutPostProcess";
import {
    isAddressStructurallyComplete,
    withResolvedSlotStep,
    withResolvedSlotStepUnlessAwaitingConfirmation,
} from "./orderSlotStep";
import { enrichProSessionCustomerFromPhone } from "./enrichCustomerFromPhone";

function resolvePipelineAiPolicy(input: ProPipelineInput): AiOrderModePolicy {
    if (input.aiOrderModePolicy) {
        return parseAiOrderModePolicy({
            ai_order_mode: input.aiOrderModePolicy.mode,
            session_idle_minutes: input.aiOrderModePolicy.sessionIdleMinutes,
            ai_session_window_minutes: input.aiOrderModePolicy.aiSessionWindowMinutes,
            ai_max_turns_per_session: input.aiOrderModePolicy.aiMaxTurnsPerSession,
        });
    }
    return parseAiOrderModePolicy(null);
}

type PipelineMetric = { name: string; value: number; tags?: Record<string, string> };

/** Envia o array de métricas do run para `MetricsPort` (logs / `METRICS_INGEST_URL` / futuro Supabase). */
function flushPipelineRunMetrics(
    port: MetricsPort,
    tenant: { companyId: string; threadId: string },
    items: PipelineMetric[],
    excludeNames?: ReadonlySet<string>
): void {
    const skip = excludeNames ?? new Set<string>();
    for (const m of items) {
        if (skip.has(m.name)) continue;
        const tags: Record<string, string> = {
            companyId: tenant.companyId,
            threadId: tenant.threadId,
        };
        if (m.tags) Object.assign(tags, m.tags);
        port.increment(m.name, m.value, tags);
    }
}

function appendAiOutcomeMetrics(
    metrics: PipelineMetric[],
    intent: string,
    invalidAiSanitized: boolean,
    aiServiceErrorCode: string | undefined
): void {
    if (invalidAiSanitized) {
        const reason: ProPipelineTelemetryReason = "ai_invalid_response";
        metrics.push({
            name: "pro_pipeline.ai_invalid_response",
            value: 1,
            tags: { intent, reason },
        });
    }
    if (aiServiceErrorCode === "TOOL_FAILED") {
        const reason: ProPipelineTelemetryReason = "tool_output_rejected";
        metrics.push({
            name: "pro_pipeline.ai_tool_round_exhausted",
            value: 1,
            tags: { intent, reason },
        });
    }
    if (aiServiceErrorCode === "AI_RATE_LIMIT") {
        const reason: ProPipelineTelemetryReason = "ai_rate_limited";
        metrics.push({
            name: "pro_pipeline.ai_rate_limited",
            value: 1,
            tags: { intent, reason },
        });
    }
    if (aiServiceErrorCode === "AI_TIMEOUT") {
        const reason: ProPipelineTelemetryReason = "ai_timeout";
        metrics.push({
            name: "pro_pipeline.ai_timeout",
            value: 1,
            tags: { intent, reason },
        });
    }
    if (aiServiceErrorCode === "AI_PROVIDER_ERROR") {
        const reason: ProPipelineTelemetryReason = "ai_provider_error";
        metrics.push({
            name: "pro_pipeline.ai_provider_error",
            value: 1,
            tags: { intent, reason },
        });
    }
}

/** Diagnóstico: rascunho + passo após IA e antes de gravar sessão (correlacionar com `order_stage.enter`). */
function logSessionDraftSnapshot(
    logger: LoggerPort | undefined,
    event: "pro_pipeline.post_ai_session" | "pro_pipeline.pre_persist_session",
    tenant: { companyId: string; threadId: string },
    state: ProSessionState,
    extra: Record<string, unknown>
): void {
    if (!logger) return;
    const d = state.draft;
    logger.info(event, {
        companyId: tenant.companyId,
        threadId: tenant.threadId,
        step: state.step,
        hasDraft: Boolean(d),
        draftItemCount: d?.items.length ?? 0,
        draftPaymentMethod: d?.paymentMethod ?? null,
        draftHasAddressBlock: Boolean(d?.address),
        draftAddressMinFields: d?.address
            ? {
                  logradouro: Boolean(String(d.address.logradouro ?? "").trim()),
                  numero: Boolean(String(d.address.numero ?? "").trim()),
                  bairro: Boolean(String(d.address.bairro ?? "").trim()),
                  cidade: Boolean(String(d.address.cidade ?? "").trim()),
                  estado: Boolean(String(d.address.estado ?? "").trim().length >= 2),
              }
            : null,
        draftGrandTotal: d?.grandTotal ?? null,
        draftPendingConfirmation: d?.pendingConfirmation ?? null,
        searchProdutoEmbalagemIdCount: state.searchProdutoEmbalagemIds.length,
        aiHistoryTurns: state.aiHistory.length,
        customerIdSet: Boolean(state.customerId),
        ...extra,
    });
}

export async function runProPipeline(
    input: ProPipelineInput,
    deps: PipelineDependencies
): Promise<ProPipelineOutput> {
    if (input.tier !== "pro") {
        const metrics: PipelineMetric[] = [{ name: "pro_pipeline.skipped_non_pro", value: 1 }];
        flushPipelineRunMetrics(deps.metrics, input.tenant, metrics);
        return {
            nextState: {
                step: "pro_idle",
                customerId: null,
                misunderstandingStreak: 0,
                escalationTier: 0,
                draft: null,
                aiHistory: [],
                searchProdutoEmbalagemIds: [],
            },
            outbound: [],
            sideEffects: [],
            metrics,
        };
    }

    const aiPolicy = resolvePipelineAiPolicy(input);
    const nowMs = Date.parse(input.nowIso) || Date.now();

    const loadedState = await loadState({ sessionRepo: deps.sessionRepo, tenant: input.tenant });
    const sessionWithCustomer = await enrichProSessionCustomerFromPhone({
        admin: deps.admin,
        companyId: input.tenant.companyId,
        phoneE164: input.tenant.phoneE164,
        profileName: input.actor.profileName ?? null,
        state: loadedState,
    });
    /** Alinha `step` ao draft antes de intent/orderStage (evita "Sim" com passo desatualizado na sessão). */
    const context = buildPipelineContext({
        input,
        session: withResolvedSlotStepUnlessAwaitingConfirmation(sessionWithCustomer),
    });

    const guarded = guardRails({ state: context.session, inboundText: input.inboundText });
    if (guarded.stop) {
        const metrics: PipelineMetric[] = [
            {
                name: "pro_pipeline.guard_stop",
                value: 1,
                tags: guarded.stopReason ? { reason: guarded.stopReason } : undefined,
            },
        ];
        flushPipelineRunMetrics(deps.metrics, input.tenant, metrics);
        return {
            nextState: guarded.state,
            outbound: guarded.outbound,
            sideEffects: [],
            metrics,
        };
    }

    const strictGate = strictCheckoutStructuredGate(input.inboundText, guarded.state);
    if (strictGate) {
        const syncedQuick = withResolvedSlotStep(strictGate.state);
        const quickOutbound = checkoutPostProcessForQuickAction({
            state: syncedQuick,
            outbound: strictGate.outbound,
        });
        await persistAndEmit({
            tenant: input.tenant,
            state: syncedQuick,
            outbound: quickOutbound,
            sessionRepo: deps.sessionRepo,
            messageGateway: deps.messageGateway,
            metrics: deps.metrics,
            logger: deps.logger,
        });
        const metrics: PipelineMetric[] = [
            {
                name: "pro_pipeline.strict_checkout_inbound_gate",
                value: 1,
                tags: { action: strictGate.actionTag ?? "strict_checkout_inbound_gate" },
            },
            { name: "pro_pipeline.outbound_count", value: quickOutbound.length },
        ];
        flushPipelineRunMetrics(deps.metrics, input.tenant, metrics, new Set(["pro_pipeline.outbound_count"]));
        return {
            nextState: syncedQuick,
            outbound: quickOutbound,
            sideEffects: [],
            metrics,
        };
    }

    const pickApplied = applyProductPickFromButton(input.inboundText, guarded.state);
    const stateAfterPick = pickApplied.state;
    const inboundTextForPipeline = pickApplied.syntheticUserText ?? input.inboundText;

    const quick = applyQuickAction(inboundTextForPipeline, stateAfterPick, {
        flowAddressRegister: input.flowAddressRegisterId
            ? {
                  flowId:    input.flowAddressRegisterId,
                  threadId:  input.tenant.threadId,
                  companyId: input.tenant.companyId,
              }
            : undefined,
    });
    if (quick.handled) {
        const syncedQuick = withResolvedSlotStep(quick.state);
        const quickOutbound = checkoutPostProcessForQuickAction({
            state: syncedQuick,
            outbound: quick.outbound,
        });
        await persistAndEmit({
            tenant: input.tenant,
            state: syncedQuick,
            outbound: quickOutbound,
            sessionRepo: deps.sessionRepo,
            messageGateway: deps.messageGateway,
            metrics: deps.metrics,
            logger: deps.logger,
        });
        const metrics: PipelineMetric[] = [
            { name: "pro_pipeline.quick_action", value: 1, tags: { action: quick.actionTag ?? "unknown" } },
            { name: "pro_pipeline.outbound_count", value: quickOutbound.length },
        ];
        flushPipelineRunMetrics(deps.metrics, input.tenant, metrics, new Set(["pro_pipeline.outbound_count"]));
        return {
            nextState: syncedQuick,
            outbound: quickOutbound,
            sideEffects: [],
            metrics,
        };
    }

    // Estado após pick de produto (allowlist estreita) ou estado do guard
    let pipelineState = stateAfterPick;
    const contextForStages: PipelineContext = { ...context, session: pipelineState };

    const decision = await intentStage({
        intentService: deps.intentService,
        context: contextForStages,
        userText: inboundTextForPipeline,
    });

    // Prioridade: se está aguardando confirmação, resolve fechamento/erro de draft
    // antes de qualquer passagem por IA para evitar desvio de fluxo.
    let highValuePolicy: { enabled: boolean; amountBrl: number } | undefined;
    if (deps.admin) {
        try {
            const { data: botRow } = await deps.admin
                .from("chatbots")
                .select("config")
                .eq("company_id", input.tenant.companyId)
                .limit(1)
                .maybeSingle();
            const { parseHighValueConfirmPolicy } = await import("@/lib/billing/aiWallet");
            highValuePolicy = parseHighValueConfirmPolicy(
                (botRow?.config as Record<string, unknown> | null) ?? null
            );
        } catch {
            highValuePolicy = undefined;
        }
    }

    const infoOnly = isInfoOnlyMode(aiPolicy);
    const preOrder = await orderStage({
        orderService: deps.orderService,
        tenant: input.tenant,
        state: pipelineState,
        decision,
        userText: inboundTextForPipeline,
        logger: deps.logger,
        highValuePolicy,
        blockFinalize: infoOnly,
        blockFinalizeMessage: buildInfoOnlyOrderBlockedText(input.webMenuUrl),
    });

    const preOrderSideMetrics: Array<{ name: string; value: number; tags?: Record<string, string> }> = [];
    if (preOrder.outcome === "skipped_weak_confirmation") {
        const reason: ProPipelineTelemetryReason = "confirmation_ambiguous";
        preOrderSideMetrics.push({
            name: "pro_pipeline.confirmation_ambiguous",
            value: 1,
            tags: { intent: decision.intent, reason },
        });
    }

    if (preOrder.outboundText) {
        // Após `order_create_failed`, `orderStage` já define `step` para `pro_collecting_order` para o
        // cliente corrigir dados; `withResolvedSlotStep` voltaria a `pro_awaiting_confirmation` só porque o
        // draft ainda está completo — preso em botões "Confirmar" com RPC que continua a falhar.
        const syncedPre =
            preOrder.outcome === "order_create_failed"
                ? preOrder.state
                : withResolvedSlotStep(preOrder.state);
        const outbound: OutboundMessage[] = [
            { kind: "text", text: preOrder.outboundText },
            ...checkoutPostProcessForQuickAction({ state: syncedPre, outbound: [] }),
        ];
        await persistAndEmit({
            tenant: input.tenant,
            state: syncedPre,
            outbound,
            sessionRepo: deps.sessionRepo,
            messageGateway: deps.messageGateway,
            metrics: deps.metrics,
            logger: deps.logger,
        });
        const metrics: Array<{ name: string; value: number; tags?: Record<string, string> }> = [
            ...preOrderSideMetrics,
            { name: "pro_pipeline.pre_order_resolved", value: 1, tags: { intent: decision.intent } },
        ];
        if (preOrder.outcome === "gate_no_draft") {
            const reason: ProPipelineTelemetryReason = "finalize_blocked";
            metrics.push({
                name: "pro_pipeline.order_precondition_failed",
                value: 1,
                tags: { intent: decision.intent, reason },
            });
        }
        if (preOrder.outcome === "gate_draft_incomplete") {
            const reason: ProPipelineTelemetryReason = "draft_validation_failed";
            metrics.push({
                name: "pro_pipeline.order_precondition_failed",
                value: 1,
                tags: { intent: decision.intent, reason },
            });
        }
        if (preOrder.orderResult && !preOrder.orderResult.ok) {
            metrics.push({
                name: "pro_pipeline.order_failed",
                value: 1,
                tags: {
                    intent: decision.intent,
                    errorCode: preOrder.orderResult.errorCode,
                    reason: "order_rejected",
                },
            });
        }
        flushPipelineRunMetrics(deps.metrics, input.tenant, metrics);
        return {
            nextState: syncedPre,
            outbound,
            sideEffects: [],
            metrics,
        };
    }

    const routed = routeStage({
        state: pipelineState,
        decision,
        inboundText: inboundTextForPipeline,
        tenant: input.tenant,
        flowCatalogId: input.flowCatalogId ?? null,
        flowStatusId: input.flowStatusId ?? null,
        webMenuUrl: input.webMenuUrl ?? null,
        messageTemplates: input.messageTemplates ?? null,
    });

    let nextState = routed.state;
    const outbound: OutboundMessage[] = [...routed.outbound];

    let invalidAiSanitized = false;
    let aiServiceErrorCode: string | undefined;
    let checkoutOrderHints: Record<string, unknown> | null = null;
    let aiLimitExceeded = false;
    if (routed.mode === "ai") {
        if (isAiTurnLimitExceeded(nextState, aiPolicy, nowMs)) {
            aiLimitExceeded = true;
            outbound.length = 0;
            outbound.push(
                ...buildAiLimitExceededOutbound({
                    webMenuUrl: input.webMenuUrl,
                    flowCatalogId: input.flowCatalogId,
                })
            );
            deps.logger?.info("pro_pipeline.ai_turn_limit_exceeded", {
                companyId: input.tenant.companyId,
                threadId: input.tenant.threadId,
                aiTurnCount: nextState.aiTurnCount ?? 0,
                maxTurns: aiPolicy.aiMaxTurnsPerSession,
            });
        } else {
            // info_only: não mantém rascunho/confirmação de pedido no WhatsApp
            if (infoOnly && nextState.draft) {
                nextState = {
                    ...nextState,
                    draft: null,
                    step:
                        nextState.step === "pro_awaiting_confirmation" ||
                        nextState.step === "pro_collecting_order"
                            ? "pro_idle"
                            : nextState.step,
                };
            }
            let aiContext: PipelineContext = { ...context, session: nextState };
            if (
                !infoOnly &&
                decision.intent === "order_intent" &&
                deps.admin &&
                nextState.customerId
            ) {
                try {
                    const prefetchedOrderHints = await buildOrderHintsPayload({
                        admin: deps.admin,
                        companyId: input.tenant.companyId,
                        phoneE164: input.tenant.phoneE164,
                        name: input.actor.profileName ?? null,
                    });
                    aiContext = { ...aiContext, prefetchedOrderHints };
                } catch (err) {
                    deps.logger?.warn("pro_pipeline.prefetch_order_hints_failed", {
                        companyId: input.tenant.companyId,
                        threadId: input.tenant.threadId,
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            const ai = await aiStage({
                aiService: deps.aiService,
                context: aiContext,
                decision,
                userText: inboundTextForPipeline,
                logger: deps.logger,
            });
            invalidAiSanitized = ai.invalidAiSanitized;
            aiServiceErrorCode = ai.aiResult.errorCode;
            nextState = bumpAiTurnCount(ai.state, aiPolicy, nowMs);
            outbound.push(...ai.outbound);
            logSessionDraftSnapshot(deps.logger, "pro_pipeline.post_ai_session", input.tenant, nextState, {
                intent: decision.intent,
                inboundSample: inboundTextForPipeline.trim().slice(0, 120),
                aiAction: ai.aiResult.action,
                aiErrorCode: ai.aiResult.errorCode ?? null,
                toolRoundsUsed: ai.aiResult.signals.toolRoundsUsed,
                invalidAiSanitized,
            });
            const d = nextState.draft;
            if (
                deps.admin &&
                d &&
                d.items.length > 0 &&
                !isAddressStructurallyComplete(d.address ?? null)
            ) {
                try {
                    checkoutOrderHints = await buildOrderHintsPayload({
                        admin:     deps.admin,
                        companyId: input.tenant.companyId,
                        phoneE164: input.tenant.phoneE164,
                        name:      input.actor.profileName ?? null,
                    });
                } catch (err) {
                    deps.logger?.warn("pro_pipeline.prefetch_checkout_order_hints_failed", {
                        companyId: input.tenant.companyId,
                        threadId:  input.tenant.threadId,
                        message:   err instanceof Error ? err.message : String(err),
                    });
                }
            }
        }
    }
    const flowIdTrim = String(input.flowAddressRegisterId ?? "").trim();
    const flowRef: FlowAddressRegisterQuickOpts | null = flowIdTrim
        ? {
              flowId:    flowIdTrim,
              threadId:  input.tenant.threadId,
              companyId: input.tenant.companyId,
          }
        : null;
    const checkout = aiLimitExceeded
        ? { state: nextState, outbound }
        : checkoutPostProcess({
              state: nextState,
              outbound,
              mode: routed.mode,
              flowAddressRegister: flowRef,
              orderHints: checkoutOrderHints,
          });
    nextState = checkout.state;
    const finalOutbound = checkout.outbound;

    logSessionDraftSnapshot(deps.logger, "pro_pipeline.pre_persist_session", input.tenant, nextState, {
        intent: decision.intent,
        inboundSample: input.inboundText.trim().slice(0, 120),
        routedMode: routed.mode,
    });

    await persistAndEmit({
        tenant: input.tenant,
        state: nextState,
        outbound: finalOutbound,
        sessionRepo: deps.sessionRepo,
        messageGateway: deps.messageGateway,
        metrics: deps.metrics,
        logger: deps.logger,
    });

    const runMetrics: PipelineMetric[] = [
        ...preOrderSideMetrics,
        { name: "pro_pipeline.run", value: 1, tags: { intent: decision.intent } },
        { name: "pro_pipeline.outbound_count", value: finalOutbound.length },
        {
            name: "pro_pipeline.slot",
            value: 1,
            tags: { intent: decision.intent, step: nextState.step },
        },
    ];
    if (aiLimitExceeded) {
        runMetrics.push({
            name: "pro_pipeline.ai_turn_limit_exceeded",
            value: 1,
            tags: { intent: decision.intent, reason: "ai_turn_limit" },
        });
    }
    appendAiOutcomeMetrics(runMetrics, decision.intent, invalidAiSanitized, aiServiceErrorCode);

    flushPipelineRunMetrics(deps.metrics, input.tenant, runMetrics, new Set(["pro_pipeline.outbound_count"]));

    return {
        nextState,
        outbound: finalOutbound,
        sideEffects: [],
        metrics: runMetrics,
    };
}

