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
import { buildAiDegradedOutbound } from "@/lib/chatbot/aiCapabilityProfile";
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
} from "./stages/checkoutPostProcess";
import { createCheckoutHandoff } from "@/lib/public-menu/handoff/createCheckoutHandoff";
import {
    isAddressStructurallyComplete,
    withResolvedSlotStep,
    withResolvedSlotStepUnlessAwaitingConfirmation,
} from "./orderSlotStep";
import { enrichProSessionCustomerFromPhone } from "./enrichCustomerFromPhone";
import { handleAwaitingPhoneTurn } from "./handleAwaitingPhone";
import { clearStaleClarifyUiIfNoDraft, isOrderSessionContinuityNeeded } from "./sessionOrderContext";
import {
    looksLikeDeliveryCoverageQuestion,
    tryAnswerDeliveryCoverageFaq,
} from "./deliveryCoverageFaq";
import {
    buildStoreHoursFaqReply,
    looksLikeStoreHoursQuestion,
} from "./storeHoursFaq";
import {
    looksLikeOrderStatusQuestion,
    tryBuildOrderStatusReply,
} from "./orderStatusFaq";
import {
    resolvePickedEmbalagemId,
    serverPrepareAfterProductPick,
} from "./serverPrepareAfterPick";
import { serverResolvePendingPicksFromFreeText } from "./serverResolvePendingPicks";
import { removePendingPickGroupContaining } from "./pendingPickGroups";
import {
    parseAddressPickButtonId,
    serverPrepareAfterAddressPick,
} from "./serverPrepareAfterAddressPick";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";
import {
    DEFAULT_FULFILLMENT_POLICY,
    loadFulfillmentPolicy,
    type FulfillmentPolicy,
} from "@/lib/delivery/fulfillment";
import {
    buildStoreClosedCustomerMessage,
    EMPTY_STORE_HOURS,
    isStoreOpen,
    loadStoreHours,
    type StoreHours,
} from "@/lib/delivery/hours";
import { loadAcceptedCustomerPayments } from "@/lib/payments/loadAcceptedCustomerPayments";
import { DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS } from "@/src/financeiro/domain/acceptedCustomerPayments";

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

/**
 * Envia o array de métricas do run para `MetricsPort` (logs / `METRICS_INGEST_URL` / futuro Supabase).
 * `provider` (Fase 9 de docs/PLANO_MULTI_PROVIDER_IA.md) só existe depois que `context` é montado
 * (linha ~274) — chamadas de erro anteriores a isso não têm o dado e seguem sem a tag.
 */
function flushPipelineRunMetrics(
    port: MetricsPort,
    tenant: { companyId: string; threadId: string },
    items: PipelineMetric[],
    excludeNames?: ReadonlySet<string>,
    provider?: string
): void {
    const skip = excludeNames ?? new Set<string>();
    for (const m of items) {
        if (skip.has(m.name)) continue;
        const tags: Record<string, string> = {
            companyId: tenant.companyId,
            threadId: tenant.threadId,
        };
        if (provider) tags.provider = provider;
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

    const fulfillmentPolicy: FulfillmentPolicy = deps.admin
        ? await loadFulfillmentPolicy(deps.admin, input.tenant.companyId)
        : DEFAULT_FULFILLMENT_POLICY;
    const acceptedPayments = deps.admin
        ? await loadAcceptedCustomerPayments(deps.admin, input.tenant.companyId)
        : DEFAULT_ACCEPTED_CUSTOMER_PAYMENTS;
    const storeHours: StoreHours = deps.admin
        ? await loadStoreHours(deps.admin, input.tenant.companyId)
        : EMPTY_STORE_HOURS;
    const storeOpen = isStoreOpen(nowMs, storeHours);
    const storeClosedMessage = buildStoreClosedCustomerMessage(storeHours, nowMs);

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

    if (!storeOpen) {
        await emitTurn({
            state: sessionWithCustomer,
            outbound: [{ kind: "text", text: storeClosedMessage }],
            telemetryReason: "store_closed",
        });
        flushPipelineRunMetrics(deps.metrics, input.tenant, [
            { name: "pro_pipeline.store_closed", value: 1 },
        ]);
        return {
            nextState: sessionWithCustomer,
            outbound: [{ kind: "text", text: storeClosedMessage }],
            sideEffects: [],
            metrics: [{ name: "pro_pipeline.store_closed", value: 1 }],
        };
    }

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
        flushPipelineRunMetrics(deps.metrics, input.tenant, metrics, undefined, context.policies.aiProvider);
        return {
            nextState: guarded.state,
            outbound: guarded.outbound,
            sideEffects: [],
            metrics,
        };
    }

    /**
     * Libera hold antes do checkout estruturado / orderStage quando o draft já está completo
     * e o inbound é o botão Confirmar (HITL — único sinal que finaliza).
     */
    let gateState = guarded.state;
    if (
        gateState.draft &&
        isDraftStructurallyCompleteForFinalize(gateState.draft) &&
        gateState.checkoutEditHold
    ) {
        const t = input.inboundText.trim().toLowerCase();
        if (t === "pro_confirm_order" || t === "btn_confirm_order" || t === "btn_confirmar") {
            gateState = withResolvedSlotStep({
                ...gateState,
                checkoutEditHold: false,
            });
        }
    }

    const strictGate = strictCheckoutStructuredGate(
        input.inboundText,
        gateState,
        acceptedPayments
    );
    if (strictGate) {
        const syncedQuick = withResolvedSlotStep(strictGate.state);
        const quickOutbound = checkoutPostProcessForQuickAction({
            state: syncedQuick,
            outbound: strictGate.outbound,
            fulfillmentPolicy,
            acceptedPayments,
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
        flushPipelineRunMetrics(
            deps.metrics,
            input.tenant,
            metrics,
            new Set(["pro_pipeline.outbound_count"]),
            context.policies.aiProvider
        );
        return {
            nextState: syncedQuick,
            outbound: quickOutbound,
            sideEffects: [],
            metrics,
        };
    }

    /**
     * Botão de escolha de endereço (mais usado vs. último pedido): decisão explícita do
     * cliente — aplica no servidor via `prepare_order_draft` (recalcula taxa/zona), sem IA.
     */
    const addressPickId = parseAddressPickButtonId(input.inboundText);
    if (
        addressPickId &&
        deps.admin &&
        (gateState.draft?.items?.length ?? 0) > 0 &&
        !isInfoOnlyMode(aiPolicy)
    ) {
        try {
            const addrPrep = await serverPrepareAfterAddressPick({
                admin: deps.admin,
                companyId: input.tenant.companyId,
                customerId: gateState.customerId,
                state: gateState,
                enderecoClienteId: addressPickId,
            });
            const synced = withResolvedSlotStep(addrPrep.state);
            const finalOutbound = addrPrep.preparedOk
                ? checkoutPostProcessForQuickAction({
                      state: synced,
                      outbound: [],
                      fulfillmentPolicy,
            acceptedPayments,
                  })
                : addrPrep.outbound;
            await emitTurn({ state: synced, outbound: finalOutbound });
            const metrics: PipelineMetric[] = [
                {
                    name: "pro_pipeline.address_pick",
                    value: 1,
                    tags: { ok: addrPrep.preparedOk ? "1" : "0" },
                },
                { name: "pro_pipeline.outbound_count", value: finalOutbound.length },
            ];
            flushPipelineRunMetrics(
                deps.metrics,
                input.tenant,
                metrics,
                new Set(["pro_pipeline.outbound_count"]),
                context.policies.aiProvider
            );
            return {
                nextState: synced,
                outbound: finalOutbound,
                sideEffects: [],
                metrics,
            };
        } catch (err) {
            deps.logger?.warn("pro_pipeline.address_pick_failed", {
                companyId: input.tenant.companyId,
                threadId: input.tenant.threadId,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    /**
     * Cérebro de linguagem = só o agent loop (aiStage / tools).
     * Antes disso: só IDs estruturados (pick, quick actions, payment) e prepare determinístico pós-pick.
     */
    const llmEnabled = context.policies.llmEnabled !== false;
    const stateBeforePick = gateState;

    const pickApplied = applyProductPickFromButton(input.inboundText, stateBeforePick);
    let stateAfterPick = pickApplied.state;
    const productPickApplied = Boolean(pickApplied.syntheticUserText);
    const inboundTextForPipeline = pickApplied.syntheticUserText ?? input.inboundText;

    /** Pick determinístico: prepare no servidor antes da IA (corta 1–2 RTTs de modelo). */
    let serverPreparedOnPick = false;
    if (productPickApplied && deps.admin && !isInfoOnlyMode(aiPolicy)) {
        const pickedId = resolvePickedEmbalagemId(stateAfterPick);
        if (pickedId) {
            stateAfterPick = {
                ...stateAfterPick,
                pendingPickGroups: removePendingPickGroupContaining(
                    stateAfterPick.pendingPickGroups ?? [],
                    pickedId
                ),
            };
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
                        fulfillmentPolicy,
            acceptedPayments,
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

    const handoffUrl = await resolveCheckoutHandoffUrl(deps, input, stateAfterPick);
    const quick = applyQuickAction(inboundTextForPipeline, stateAfterPick, {
        checkoutHandoffUrl: handoffUrl,
        fulfillmentPolicy,
        acceptedPayments,
    });
    /** Sempre aplica estado do quick (ex.: sair de awaiting_change sem engolir a mensagem). */
    stateAfterPick = quick.state;
    if (quick.handled) {
        const syncedQuick = withResolvedSlotStep(quick.state);
        const quickOutbound = checkoutPostProcessForQuickAction({
            state: syncedQuick,
            outbound: quick.outbound,
            fulfillmentPolicy,
            acceptedPayments,
        });
        await emitTurn({
                state: syncedQuick,
                outbound: quickOutbound,
            });
        const metrics: PipelineMetric[] = [
            { name: "pro_pipeline.quick_action", value: 1, tags: { action: quick.actionTag ?? "unknown" } },
            { name: "pro_pipeline.outbound_count", value: quickOutbound.length },
        ];
        flushPipelineRunMetrics(
            deps.metrics,
            input.tenant,
            metrics,
            new Set(["pro_pipeline.outbound_count"]),
            context.policies.aiProvider
        );
        return {
            nextState: syncedQuick,
            outbound: quickOutbound,
            sideEffects: [],
            metrics,
        };
    }

    /**
     * Texto livre respondendo embalagem ambígua de 1+ produtos (`pendingPickGroups`): resolve
     * determinísticamente ANTES da IA — sem isso, a IA respondia em prosa livre em paralelo ao
     * card de botões do servidor, gerando mensagens duplicadas/contraditórias (ver docs/PLANO_
     * MIGRACAO_VERCEL_AI_SDK.md, bug de coerência do S2).
     */
    if (
        !productPickApplied &&
        deps.admin &&
        !isInfoOnlyMode(aiPolicy) &&
        (stateAfterPick.pendingPickGroups?.length ?? 0) > 0
    ) {
        try {
            const pendingResolve = await serverResolvePendingPicksFromFreeText({
                admin: deps.admin,
                companyId: input.tenant.companyId,
                customerId: stateAfterPick.customerId,
                state: stateAfterPick,
                userText: inboundTextForPipeline,
            });
            stateAfterPick = pendingResolve.state;
            if (pendingResolve.handled) {
                const synced = withResolvedSlotStep(stateAfterPick);
                await emitTurn({ state: synced, outbound: pendingResolve.outbound });
                const metrics: PipelineMetric[] = [
                    { name: "pro_pipeline.pending_pick_free_text", value: 1 },
                    { name: "pro_pipeline.outbound_count", value: pendingResolve.outbound.length },
                ];
                flushPipelineRunMetrics(
                    deps.metrics,
                    input.tenant,
                    metrics,
                    new Set(["pro_pipeline.outbound_count"])
                );
                return {
                    nextState: synced,
                    outbound: pendingResolve.outbound,
                    sideEffects: [],
                    metrics,
                };
            }
        } catch (err) {
            deps.logger?.warn("pro_pipeline.pending_pick_resolve_failed", {
                companyId: input.tenant.companyId,
                threadId: input.tenant.threadId,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    // Estado após pick de produto (allowlist estreita) ou estado do guard
    let pipelineState = stateAfterPick;
    const contextForStages: PipelineContext = { ...context, session: pipelineState };

    /**
     * Fast paths determinísticos ANTES do intent LLM (economia de 1 round Haiku).
     */
    if (looksLikeStoreHoursQuestion(inboundTextForPipeline)) {
        const hoursReply = buildStoreHoursFaqReply(storeHours, nowMs);
        const synced = withResolvedSlotStep(pipelineState);
        const outbound: OutboundMessage[] = [{ kind: "text", text: hoursReply }];
        await emitTurn({ state: synced, outbound });
        const metrics: PipelineMetric[] = [
            { name: "pro_pipeline.store_hours_faq", value: 1 },
            { name: "pro_pipeline.outbound_count", value: outbound.length },
        ];
        flushPipelineRunMetrics(
            deps.metrics,
            input.tenant,
            metrics,
            new Set(["pro_pipeline.outbound_count"])
        );
        return {
            nextState: synced,
            outbound,
            sideEffects: [],
            metrics,
        };
    }

    if (deps.admin && looksLikeDeliveryCoverageQuestion(inboundTextForPipeline)) {
        try {
            const coverageReply = await tryAnswerDeliveryCoverageFaq({
                admin: deps.admin,
                companyId: input.tenant.companyId,
                userText: inboundTextForPipeline,
            });
            if (coverageReply) {
                const synced = withResolvedSlotStep(pipelineState);
                const outbound: OutboundMessage[] = [{ kind: "text", text: coverageReply }];
                await emitTurn({ state: synced, outbound });
                const metrics: PipelineMetric[] = [
                    { name: "pro_pipeline.delivery_coverage_faq", value: 1 },
                    { name: "pro_pipeline.outbound_count", value: outbound.length },
                ];
                flushPipelineRunMetrics(
                    deps.metrics,
                    input.tenant,
                    metrics,
                    new Set(["pro_pipeline.outbound_count"])
                );
                return {
                    nextState: synced,
                    outbound,
                    sideEffects: [],
                    metrics,
                };
            }
        } catch (err) {
            deps.logger?.warn("pro_pipeline.delivery_coverage_faq_failed", {
                companyId: input.tenant.companyId,
                threadId: input.tenant.threadId,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    if (
        deps.admin &&
        looksLikeOrderStatusQuestion(inboundTextForPipeline) &&
        pipelineState.customerId
    ) {
        try {
            const statusReply = await tryBuildOrderStatusReply({
                admin: deps.admin,
                companyId: input.tenant.companyId,
                customerId: pipelineState.customerId,
            });
            if (statusReply) {
                const synced = withResolvedSlotStep(pipelineState);
                const outbound: OutboundMessage[] = [{ kind: "text", text: statusReply }];
                await emitTurn({ state: synced, outbound });
                const metrics: PipelineMetric[] = [
                    { name: "pro_pipeline.order_status_faq", value: 1 },
                    { name: "pro_pipeline.outbound_count", value: outbound.length },
                ];
                flushPipelineRunMetrics(
                    deps.metrics,
                    input.tenant,
                    metrics,
                    new Set(["pro_pipeline.outbound_count"])
                );
                return {
                    nextState: synced,
                    outbound,
                    sideEffects: [],
                    metrics,
                };
            }
        } catch (err) {
            deps.logger?.warn("pro_pipeline.order_status_faq_failed", {
                companyId: input.tenant.companyId,
                threadId: input.tenant.threadId,
                message: err instanceof Error ? err.message : String(err),
            });
        }
    }

    const decision = await intentStage({
        intentService: deps.intentService,
        context: contextForStages,
        userText: inboundTextForPipeline,
    });

    /**
     * S1 / abandono: greeting|faq|unknown sem itens no draft não deve reemitir
     * botões de pick residual (lastSearchPicks) junto com boas-vindas.
     */
    if (
        (decision.intent === "greeting" ||
            decision.intent === "faq" ||
            decision.intent === "unknown") &&
        !(pipelineState.draft?.items?.length)
    ) {
        pipelineState = clearStaleClarifyUiIfNoDraft(pipelineState);
    }

    // Prioridade: se está aguardando confirmação, resolve fechamento/erro de draft
    // antes de qualquer passagem por IA para evitar desvio de fluxo.
    let highValuePolicy: { enabled: boolean; amountBrl: number } | undefined;
    /** Só precisa da policy no passo de confirmação (evita SELECT em todo turno de coleta). */
    if (pipelineState.step === "pro_awaiting_confirmation" && deps.companyPolicy) {
        highValuePolicy = await deps.companyPolicy.getHighValueConfirmPolicy(
            input.tenant.companyId
        );
    }

    const infoOnly = isInfoOnlyMode(aiPolicy);
    const blockFinalize = infoOnly || !storeOpen;
    const blockFinalizeMessage = infoOnly
        ? buildInfoOnlyOrderBlockedText(input.webMenuUrl)
        : storeClosedMessage;
    const preOrder = await orderStage({
        orderService: deps.orderService,
        tenant: input.tenant,
        state: pipelineState,
        decision,
        userText: inboundTextForPipeline,
        logger: deps.logger,
        highValuePolicy,
        blockFinalize,
        blockFinalizeMessage,
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
            ...checkoutPostProcessForQuickAction({
                state: syncedPre,
                outbound: [],
                fulfillmentPolicy,
            acceptedPayments,
            }),
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
        flushPipelineRunMetrics(deps.metrics, input.tenant, metrics, undefined, context.policies.aiProvider);
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
        webMenuUrl: input.webMenuUrl ?? null,
        webMenuOrdersUrl: input.webMenuOrdersUrl ?? null,
        messageTemplates: input.messageTemplates ?? null,
        llmEnabled,
    });

    let nextState = routed.state;
    const outbound: OutboundMessage[] = [...routed.outbound];

    let invalidAiSanitized = false;
    let aiServiceErrorCode: string | undefined;
    let aiToolRoundsUsed = 0;
    let checkoutOrderHints: Record<string, unknown> | null = null;
    let aiLimitExceeded = false;
    let addressFreeTextSignaled = false;
    /** Sem crédito / IA off: menu/status/handover ok; pedido por IA bloqueado (D6). */
    let aiDegradedThisTurn = false;
    if (routed.mode === "ai" && !llmEnabled) {
        aiDegradedThisTurn = true;
        outbound.length = 0;
        outbound.push(
            ...buildAiDegradedOutbound({
                webMenuUrl: input.webMenuUrl,
                reason: input.aiCapability?.degradedReason ?? null,
            })
        );
        deps.metrics.increment("pro_pipeline.ai_degraded", 1, {
            companyId: input.tenant.companyId,
            tier: input.aiCapability?.tier ?? "degradado",
            reason: input.aiCapability?.degradedReason ?? "unknown",
        });
    } else if (routed.mode === "ai") {
        if (isAiTurnLimitExceeded(nextState, aiPolicy, nowMs)) {
            aiLimitExceeded = true;
            outbound.length = 0;
            outbound.push(
                ...buildAiLimitExceededOutbound({
                    webMenuUrl: input.webMenuUrl,
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
            const shouldPrefetchHints =
                !infoOnly &&
                Boolean(nextState.customerId) &&
                (decision.intent === "order_intent" ||
                    isOrderSessionContinuityNeeded(nextState));
            if (shouldPrefetchHints) {
                try {
                    if (deps.orderHints) {
                        prefetchedOrderHints = await deps.orderHints.buildHints({
                            companyId: input.tenant.companyId,
                            phoneE164: input.tenant.phoneE164,
                            name: input.actor.profileName ?? null,
                        });
                    } else if (deps.admin) {
                        prefetchedOrderHints = await buildOrderHintsPayload({
                            admin: deps.admin,
                            companyId: input.tenant.companyId,
                            phoneE164: input.tenant.phoneE164,
                            name: input.actor.profileName ?? null,
                        });
                    }
                    if (prefetchedOrderHints) {
                        aiContext = { ...aiContext, prefetchedOrderHints };
                    }
                } catch (err) {
                    deps.logger?.warn("pro_pipeline.prefetch_order_hints_failed", {
                        companyId: input.tenant.companyId,
                        threadId: input.tenant.threadId,
                        message: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            const singleOfferAllowlist =
                (nextState.searchProdutoEmbalagemIds?.length ?? 0) === 1 ||
                (nextState.lastSearchPicks?.length ?? 0) === 1;
            const forcePrepareOnClearSku =
                decision.intent === "order_intent" &&
                !infoOnly &&
                singleOfferAllowlist &&
                (nextState.step === "pro_collecting_order" ||
                    nextState.step === "pro_idle" ||
                    nextState.checkoutEditHold === true);
            const ai = await aiStage({
                aiService: deps.aiService,
                context: aiContext,
                decision,
                userText: inboundTextForPipeline,
                logger: deps.logger,
                /**
                 * tool_choice=prepare quando o contrato já tem SKU único (pick ou oferta)
                 * e ainda não houve prepare neste turno no servidor.
                 */
                preferPrepareToolChoiceFirst:
                    (productPickApplied && !serverPreparedOnPick) ||
                    (forcePrepareOnClearSku && !serverPreparedOnPick),
                skipForcePrepareAfterPick: serverPreparedOnPick,
            });
            invalidAiSanitized = ai.invalidAiSanitized;
            aiServiceErrorCode = ai.aiResult.errorCode;
            aiToolRoundsUsed = Number(ai.aiResult.signals.toolRoundsUsed ?? 0) || 0;
            addressFreeTextSignaled = ai.aiResult.signals.addressFreeText === true;
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
                (deps.orderHints || deps.admin) &&
                d &&
                d.items.length > 0 &&
                !isAddressStructurallyComplete(d.address ?? null)
            ) {
                if (prefetchedOrderHints) {
                    checkoutOrderHints = prefetchedOrderHints;
                } else {
                    try {
                        if (deps.orderHints) {
                            checkoutOrderHints = await deps.orderHints.buildHints({
                                companyId: input.tenant.companyId,
                                phoneE164: input.tenant.phoneE164,
                                name: input.actor.profileName ?? null,
                            });
                        } else if (deps.admin) {
                            checkoutOrderHints = await buildOrderHintsPayload({
                                admin:     deps.admin,
                                companyId: input.tenant.companyId,
                                phoneE164: input.tenant.phoneE164,
                                name:      input.actor.profileName ?? null,
                            });
                        }
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

    /**
     * D6: falha de provider/timeout após retries in-process → cardápio (não 429 — esse requeue).
     */
    if (
        aiServiceErrorCode === "AI_PROVIDER_ERROR" ||
        aiServiceErrorCode === "AI_TIMEOUT"
    ) {
        aiDegradedThisTurn = true;
        outbound.length = 0;
        outbound.push(
            ...buildAiDegradedOutbound({
                webMenuUrl: input.webMenuUrl,
                reason: "llm_error",
            })
        );
        deps.metrics.increment("pro_pipeline.ai_degraded", 1, {
            companyId: input.tenant.companyId,
            tier: "degradado",
            reason: "llm_error",
            errorCode: aiServiceErrorCode,
        });
    }

    const checkoutHandoffUrl = await resolveCheckoutHandoffUrl(deps, input, nextState);
    const skipCheckoutUi = aiLimitExceeded || aiDegradedThisTurn;
    const checkout = skipCheckoutUi
        ? { state: nextState, outbound }
        : checkoutPostProcess({
              state: nextState,
              outbound,
              mode: routed.mode,
              checkoutHandoffUrl,
              orderHints: checkoutOrderHints,
              addressFreeTextSignaled,
              fulfillmentPolicy,
            acceptedPayments,
          });
    nextState = checkout.state;
    const finalOutbound = checkout.outbound;

    logSessionDraftSnapshot(deps.logger, "pro_pipeline.pre_persist_session", input.tenant, nextState, {
        intent: decision.intent,
        inboundSample: input.inboundText.trim().slice(0, 120),
        routedMode: routed.mode,
    });

    /**
     * Rate limit de LLM (qualquer provider): não envia bolha ao cliente; job volta pra fila com
     * backoff. In-process retries + circuit breaker (isolado por provider) já esgotados em
     * `runLlmWithResilience` (`lib/chatbot/llmResilience.ts`).
     */
    if (aiServiceErrorCode === "AI_RATE_LIMIT") {
        await deps.sessionRepo.save(input.tenant.companyId, input.tenant.threadId, nextState);
        const { QueueRetryableError } = await import("@/lib/chatbot/queueRetry");
        throw new QueueRetryableError(
            "AI_RATE_LIMIT",
            "Anthropic rate limited — requeue with backoff"
        );
    }

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
    if (decision.reasonCode === "defer_to_agent") {
        runMetrics.push({
            name: "pro_pipeline.intent_llm_skipped",
            value: 1,
            tags: { intent: decision.intent },
        });
    }
    if (aiToolRoundsUsed > 0) {
        runMetrics.push({
            name: "pro_pipeline.tool_rounds_used",
            value: aiToolRoundsUsed,
            tags: { intent: decision.intent },
        });
    }
    if (aiLimitExceeded) {
        runMetrics.push({
            name: "pro_pipeline.ai_turn_limit_exceeded",
            value: 1,
            tags: { intent: decision.intent, reason: "ai_turn_limit" },
        });
    }
    appendAiOutcomeMetrics(runMetrics, decision.intent, invalidAiSanitized, aiServiceErrorCode);

    flushPipelineRunMetrics(
        deps.metrics,
        input.tenant,
        runMetrics,
        new Set(["pro_pipeline.outbound_count"]),
        context.policies.aiProvider
    );

    return {
        nextState,
        outbound: finalOutbound,
        sideEffects: [],
        metrics: runMetrics,
    };
}

async function resolveCheckoutHandoffUrl(
    deps: PipelineDependencies,
    input: ProPipelineInput,
    state: ProSessionState
): Promise<string | null> {
    const web = String(input.webMenuUrl ?? "").trim();
    if (!web) return null;
    if (!state.draft?.items.length || !deps.admin) return web;
    return createCheckoutHandoff({
        admin: deps.admin,
        companyId: input.tenant.companyId,
        threadId: input.tenant.threadId,
        webMenuUrl: web,
        draft: state.draft,
    });
}

