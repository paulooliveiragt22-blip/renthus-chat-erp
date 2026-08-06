import type {
    OutboundMessage,
    PipelineContext,
    ProPipelineInput,
    ProPipelineOutput,
    ProPipelineTelemetryReason,
    ProSessionState,
} from "@/src/types/contracts";
import { buildOrderHintsPayload } from "@/src/pro/tools/orderHints";
import {
    buildAiLimitExceededOutbound,
    buildInfoOnlyOrderBlockedText,
    bumpAiTurnCount,
    isAiTurnLimitExceeded,
    isInfoOnlyMode,
    parseAiOrderModePolicy,
    type AiOrderModePolicy,
} from "@/lib/chatbot/aiOrderModePolicy";
import { AI_DEGRADED_ORDER_MESSAGE_PT_BR } from "@/lib/chatbot/aiCapabilityProfile";
import { buildWebMenuOfferText } from "@/lib/public-menu/menuOfferText";
import type { LoggerPort } from "../ports/logger.port";
import { buildPipelineContext, policiesFromAiCapability, DEFAULT_PRO_POLICIES, type PipelineDependencies } from "./context";
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
import { handleAwaitingPhoneTurn } from "./handleAwaitingPhone";
import {
    resolvePickedEmbalagemId,
    serverPrepareAfterProductPick,
} from "./serverPrepareAfterPick";
import { tryServerSwapEdit } from "./serverSwapEdit";
import { tryServerBootstrapOrderFromText } from "./serverBootstrapOrder";
import { PICK_EMB_PREFIX, parseProductPickIndex } from "./productPickText";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";
import {
    buildBootstrapSegmentPlanFromExtraction,
    swapIntentFromExtraction,
} from "./bootstrapSegmentPlan";
import { extractOrderLinesStructured } from "@/src/pro/services/extraction/structuredOrderExtract";
import { createLlmPort } from "@/src/pro/adapters/llm/createLlmPort";
import type { OrderLineExtraction } from "@/src/domain/contracts/orderExtraction";

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
        messagingChannel: input.tenant.messagingChannel ?? input.actor.channel,
        channelUserId: input.tenant.channelUserId,
    });

    const emitTurn = async (args: {
        state: ProSessionState;
        outbound: OutboundMessage[];
        telemetryReason?: string | null;
    }) => {
        await persistAndEmit({
            tenant: input.tenant,
            state: args.state,
            outbound: args.outbound,
            sessionRepo: deps.sessionRepo,
            messageGateway: deps.messageGateway,
            metrics: deps.metrics,
            logger: deps.logger,
            turnTrace: {
                stateBefore: sessionWithCustomer,
                admin: deps.admin,
                aiProfile: input.aiCapability?.tier ?? null,
                telemetryReason: args.telemetryReason ?? null,
            },
        });
    };

    /** Só captura telefone no passo dedicado (após NEEDS_PHONE no checkout). */
    if (deps.admin && sessionWithCustomer.step === "pro_awaiting_phone") {
        const phoneTurn = await handleAwaitingPhoneTurn({
            admin: deps.admin,
            tenant: input.tenant,
            state: sessionWithCustomer,
            userText: input.inboundText,
            messagingChannel: input.tenant.messagingChannel ?? input.actor.channel,
        });
        if (phoneTurn.handled && phoneTurn.outboundText) {
            await emitTurn({
                state: phoneTurn.state,
                outbound: [{ kind: "text", text: phoneTurn.outboundText }],
            });
            flushPipelineRunMetrics(deps.metrics, input.tenant, [
                { name: "pro_pipeline.phone_capture", value: 1 },
            ]);
            return {
                nextState: phoneTurn.state,
                outbound: [{ kind: "text", text: phoneTurn.outboundText }],
                sideEffects: [],
                metrics: [{ name: "pro_pipeline.phone_capture", value: 1 }],
            };
        }
    }

    /** Alinha `step` ao draft antes de intent/orderStage (evita "Sim" com passo desatualizado na sessão). */
    const sessionAligned = withResolvedSlotStepUnlessAwaitingConfirmation(sessionWithCustomer);
    const basePolicies =
        policiesFromAiCapability(input.aiCapability) ?? DEFAULT_PRO_POLICIES;
    /** Limite de turnos esgotado → mesmo comportamento do degradado (regex / menu, sem LLM). */
    const turnLimitHit = isAiTurnLimitExceeded(sessionAligned, aiPolicy, nowMs);
    const effectivePolicies = turnLimitHit
        ? { ...basePolicies, llmEnabled: false, maxToolRounds: 0 }
        : basePolicies;
    const context = buildPipelineContext({
        input,
        session: sessionAligned,
        policies: effectivePolicies,
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
        await emitTurn({
                state: syncedQuick,
                outbound: quickOutbound,
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

    /** Extração LLM: única fonte de itens/qty/pagamento/swap (sem regex de pedido). */
    let stateBeforePick = guarded.state;
    const llmEnabled = context.policies.llmEnabled !== false;
    let orderExtraction: OrderLineExtraction | null = null;

    const skipExtract =
        input.inboundText.trim().toLowerCase().startsWith(PICK_EMB_PREFIX) ||
        parseProductPickIndex(input.inboundText) != null ||
        input.inboundText.trim().length < 4;

    if (deps.admin && llmEnabled && !skipExtract) {
        try {
            orderExtraction = await extractOrderLinesStructured({
                llm: createLlmPort(deps.admin),
                userText: input.inboundText,
                companyId: input.tenant.companyId,
            });
        } catch (e) {
            deps.logger.warn("pro_pipeline.structured_extract_failed", {
                message: e instanceof Error ? e.message : String(e),
            });
        }
    }

    if (orderExtraction?.paymentMethod) {
        stateBeforePick = {
            ...stateBeforePick,
            inferredPaymentMethod: orderExtraction.paymentMethod,
        };
    }

    const swapIntent = swapIntentFromExtraction(orderExtraction);
    const bootstrapSegmentPlan = buildBootstrapSegmentPlanFromExtraction(orderExtraction);

    /**
     * Bootstrap multi-item no servidor (antes da IA): resolve SKUs unívocos + clarifica o 1º ambíguo.
     * Nunca no texto de troca — senão acrescenta CX sem remover o UN.
     */
    let bootstrapOutbound: OutboundMessage[] = [];
    if (
        llmEnabled &&
        deps.admin &&
        !isInfoOnlyMode(aiPolicy) &&
        !skipExtract &&
        !swapIntent &&
        bootstrapSegmentPlan &&
        bootstrapSegmentPlan.segments.length >= 1 &&
        (!(stateBeforePick.draft?.items?.length) || stateBeforePick.checkoutEditHold === true)
    ) {
        try {
            const boot = await tryServerBootstrapOrderFromText({
                admin: deps.admin,
                companyId: input.tenant.companyId,
                customerId: stateBeforePick.customerId,
                state: stateBeforePick,
                userText: input.inboundText,
                segmentPlan: bootstrapSegmentPlan,
            });
            stateBeforePick = boot.state;
            bootstrapOutbound = boot.outbound;
            /** Clarificação do bootstrap: sempre responde já (mesmo se prepare parcial falhou). */
            if (boot.hasClarification && bootstrapOutbound.length > 0) {
                const syncedBoot = withResolvedSlotStep(boot.state);
                await emitTurn({
                state: syncedBoot,
                outbound: bootstrapOutbound,
            });
                const metrics: PipelineMetric[] = [
                    {
                        name: "pro_pipeline.server_bootstrap_order",
                        value: 1,
                        tags: {
                            clarify: "1",
                            draft_items: String(boot.state.draft?.items?.length ?? 0),
                            segment_source: boot.segmentSource,
                        },
                    },
                    { name: "pro_pipeline.outbound_count", value: bootstrapOutbound.length },
                ];
                flushPipelineRunMetrics(
                    deps.metrics,
                    input.tenant,
                    metrics,
                    new Set(["pro_pipeline.outbound_count"])
                );
                return {
                    nextState: syncedBoot,
                    outbound: bootstrapOutbound,
                    sideEffects: [],
                    metrics,
                };
            }
            if (
                boot.bootstrapped &&
                boot.state.draft &&
                isDraftStructurallyCompleteForFinalize(boot.state.draft)
            ) {
                const finalState = withResolvedSlotStep({
                    ...boot.state,
                    checkoutEditHold: false,
                });
                const finalOutbound = checkoutPostProcessForQuickAction({
                    state: finalState,
                    outbound: [],
                });
                await emitTurn({
                state: finalState,
                outbound: finalOutbound,
            });
                const metrics: PipelineMetric[] = [
                    {
                        name: "pro_pipeline.server_bootstrap_order",
                        value: 1,
                        tags: {
                            clarify: "0",
                            complete: "1",
                            segment_source: boot.segmentSource,
                        },
                    },
                    { name: "pro_pipeline.outbound_count", value: finalOutbound.length },
                ];
                flushPipelineRunMetrics(
                    deps.metrics,
                    input.tenant,
                    metrics,
                    new Set(["pro_pipeline.outbound_count"])
                );
                return {
                    nextState: finalState,
                    outbound: finalOutbound,
                    sideEffects: [],
                    metrics,
                };
            }
        } catch (err) {
            deps.logger?.warn("pro_pipeline.server_bootstrap_order_failed", {
                companyId: input.tenant.companyId,
                threadId: input.tenant.threadId,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    const pickApplied = applyProductPickFromButton(input.inboundText, stateBeforePick);
    let stateAfterPick = pickApplied.state;
    const productPickApplied = Boolean(pickApplied.syntheticUserText);
    const inboundTextForPipeline = pickApplied.syntheticUserText ?? input.inboundText;

    /** Pick determinístico: prepare no servidor antes da IA (corta 1–2 RTTs de modelo). */
    let serverPreparedOnPick = false;
    if (productPickApplied && deps.admin && !isInfoOnlyMode(aiPolicy)) {
        const pickedId = resolvePickedEmbalagemId(stateAfterPick);
        if (pickedId) {
            try {
                const recentUserText = [
                    input.inboundText,
                    ...[...(stateAfterPick.aiHistory ?? [])]
                        .reverse()
                        .filter((h) => h.role === "user")
                        .slice(0, 3)
                        .map((h) => (typeof h.content === "string" ? h.content : "")),
                ].join("\n");
                const serverPrep = await serverPrepareAfterProductPick({
                    admin: deps.admin,
                    companyId: input.tenant.companyId,
                    customerId: stateAfterPick.customerId,
                    state: stateAfterPick,
                    pickedEmbalagemId: pickedId,
                    recentUserText,
                });
                stateAfterPick = serverPrep.state;
                serverPreparedOnPick = Boolean(serverPrep.state.draft?.items?.length);
                /** Ainda há itens ambíguos do bootstrap (ex.: salgadinho após Heineken). */
                if (serverPrep.clarificationOutbound.length > 0) {
                    const synced = withResolvedSlotStep(stateAfterPick);
                    await emitTurn({
                state: synced,
                outbound: serverPrep.clarificationOutbound,
            });
                    const metrics: PipelineMetric[] = [
                        {
                            name: "pro_pipeline.server_prepare_pick",
                            value: 1,
                            tags: { skipped_ai: "1", pending_clarify: "1" },
                        },
                        {
                            name: "pro_pipeline.outbound_count",
                            value: serverPrep.clarificationOutbound.length,
                        },
                    ];
                    flushPipelineRunMetrics(
                        deps.metrics,
                        input.tenant,
                        metrics,
                        new Set(["pro_pipeline.outbound_count"])
                    );
                    return {
                        nextState: synced,
                        outbound: serverPrep.clarificationOutbound,
                        sideEffects: [],
                        metrics,
                    };
                }
                if (serverPrep.skipAi) {
                    const finalState = withResolvedSlotStep({
                        ...stateAfterPick,
                        checkoutEditHold: false,
                    });
                    const finalOutbound = checkoutPostProcessForQuickAction({
                        state: finalState,
                        outbound: [],
                    });
                    await emitTurn({
                state: finalState,
                outbound: finalOutbound,
            });
                    const metrics: PipelineMetric[] = [
                        {
                            name: "pro_pipeline.server_prepare_pick",
                            value: 1,
                            tags: { skipped_ai: "1" },
                        },
                        { name: "pro_pipeline.outbound_count", value: finalOutbound.length },
                    ];
                    flushPipelineRunMetrics(
                        deps.metrics,
                        input.tenant,
                        metrics,
                        new Set(["pro_pipeline.outbound_count"])
                    );
                    return {
                        nextState: finalState,
                        outbound: finalOutbound,
                        sideEffects: [],
                        metrics,
                    };
                }
            } catch (err) {
                deps.logger?.warn("pro_pipeline.server_prepare_pick_failed", {
                    companyId: input.tenant.companyId,
                    threadId: input.tenant.threadId,
                    message: err instanceof Error ? err.message : String(err),
                });
            }
        }
    }

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
        await emitTurn({
                state: syncedQuick,
                outbound: quickOutbound,
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

    /** Troca/substitui no servidor (Corrigir → "troca X pela Y") — evita busca errada da IA. */
    if (
        llmEnabled &&
        deps.admin &&
        !isInfoOnlyMode(aiPolicy) &&
        !productPickApplied &&
        stateAfterPick.draft?.items?.length
    ) {
        try {
            const swapEdit = await tryServerSwapEdit({
                admin: deps.admin,
                companyId: input.tenant.companyId,
                customerId: stateAfterPick.customerId,
                state: stateAfterPick,
                userText: inboundTextForPipeline,
                swapIntent,
            });
            if (swapEdit.handled) {
                const syncedSwap = withResolvedSlotStep(swapEdit.state);
                const outboundFinal = swapEdit.outbound;
                await emitTurn({
                state: syncedSwap,
                outbound: outboundFinal,
            });
                const metrics: PipelineMetric[] = [
                    {
                        name: "pro_pipeline.server_swap_edit",
                        value: 1,
                        tags: { finalized: swapEdit.finalized ? "1" : "0" },
                    },
                    { name: "pro_pipeline.outbound_count", value: outboundFinal.length },
                ];
                flushPipelineRunMetrics(
                    deps.metrics,
                    input.tenant,
                    metrics,
                    new Set(["pro_pipeline.outbound_count"])
                );
                return {
                    nextState: syncedSwap,
                    outbound: outboundFinal,
                    sideEffects: [],
                    metrics,
                };
            }
        } catch (err) {
            deps.logger?.warn("pro_pipeline.server_swap_edit_failed", {
                companyId: input.tenant.companyId,
                threadId: input.tenant.threadId,
                message: err instanceof Error ? err.message : String(err),
            });
        }
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
    /** Só precisa da policy no passo de confirmação (evita SELECT em todo turno de coleta). */
    if (deps.admin && pipelineState.step === "pro_awaiting_confirmation") {
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

    /** orderStage pode liberar confirmação (checkoutEditHold) — propaga para IA/rota. */
    pipelineState = preOrder.state;

    const preOrderSideMetrics: Array<{ name: string; value: number; tags?: Record<string, string> }> = [];
    if (preOrder.outcome === "skipped_weak_confirmation") {
        const reason: ProPipelineTelemetryReason = preOrder.state.checkoutEditHold
            ? "confirmation_revision"
            : "confirmation_ambiguous";
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
        await emitTurn({
            state: syncedPre,
            outbound,
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
        llmEnabled,
    });

    let nextState = routed.state;
    const outbound: OutboundMessage[] = [...routed.outbound];

    let invalidAiSanitized = false;
    let aiServiceErrorCode: string | undefined;
    let checkoutOrderHints: Record<string, unknown> | null = null;
    let aiLimitExceeded = false;
    /** Sem crédito / IA off: menu/status/handover ok; pedido por IA bloqueado. */
    if (routed.mode === "ai" && !llmEnabled) {
        outbound.length = 0;
        if (input.webMenuUrl) {
            outbound.push({
                kind: "text",
                text:
                    AI_DEGRADED_ORDER_MESSAGE_PT_BR +
                    "\n\n" +
                    buildWebMenuOfferText({ url: input.webMenuUrl }),
            });
        } else {
            outbound.push({ kind: "text", text: AI_DEGRADED_ORDER_MESSAGE_PT_BR });
        }
        deps.metrics.increment("pro_pipeline.ai_degraded", 1, {
            companyId: input.tenant.companyId,
            tier: input.aiCapability?.tier ?? "degradado",
        });
    } else if (routed.mode === "ai") {
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
            let prefetchedOrderHints: Record<string, unknown> | null = null;
            if (
                !infoOnly &&
                decision.intent === "order_intent" &&
                deps.admin &&
                nextState.customerId
            ) {
                try {
                    prefetchedOrderHints = await buildOrderHintsPayload({
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
                /** Só força prepare na 1ª chamada se o pick ainda não foi aplicado no servidor. */
                preferPrepareToolChoiceFirst: productPickApplied && !serverPreparedOnPick,
                skipForcePrepareAfterPick: serverPreparedOnPick,
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
                if (prefetchedOrderHints) {
                    checkoutOrderHints = prefetchedOrderHints;
                } else {
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

    await emitTurn({
                state: nextState,
                outbound: finalOutbound,
            });

    /** Handover: desliga bot + abre ticket (efeito que o Starter fazia em `doHandover`). */
    if (decision.intent === "human_intent" && nextState.step === "handover" && deps.admin) {
        try {
            const { applyProHandover } = await import("./applyHandover");
            const hr = await applyProHandover({
                admin: deps.admin,
                companyId: input.tenant.companyId,
                threadId: input.tenant.threadId,
                phoneE164: input.tenant.phoneE164 || null,
                customerId: nextState.customerId,
                customerName: input.actor.profileName ?? null,
                channel: input.actor.channel,
                reason:
                    input.actor.channel === "instagram"
                        ? "Cliente solicitou atendimento humano via Instagram"
                        : input.actor.channel === "messenger"
                          ? "Cliente solicitou atendimento humano via Messenger"
                          : "Cliente solicitou atendimento humano via WhatsApp",
            });
            deps.logger?.info("pro_pipeline.handover_applied", {
                companyId: input.tenant.companyId,
                threadId: input.tenant.threadId,
                ticketCreated: hr.ticketCreated,
                ticketId: hr.ticketId,
            });
            deps.metrics.increment("pro_pipeline.handover", 1, {
                companyId: input.tenant.companyId,
                ticket: hr.ticketCreated ? "created" : "existing",
            });
        } catch (err) {
            deps.logger?.error("pro_pipeline.handover_failed", {
                companyId: input.tenant.companyId,
                threadId: input.tenant.threadId,
                message: err instanceof Error ? err.message : String(err),
            });
            deps.metrics.increment("pro_pipeline.handover_failed", 1, {
                companyId: input.tenant.companyId,
            });
        }
    }

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

