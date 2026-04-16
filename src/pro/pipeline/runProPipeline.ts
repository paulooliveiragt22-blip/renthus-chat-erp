import type {
    OutboundMessage,
    ProPipelineInput,
    ProPipelineOutput,
    ProPipelineTelemetryReason,
} from "@/src/types/contracts";
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
    applyQuickAction,
    checkoutPostProcess,
    checkoutPostProcessForQuickAction,
} from "./stages/checkoutPostProcess";

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
            },
            outbound: [],
            sideEffects: [],
            metrics,
        };
    }

    const loadedState = await loadState({ sessionRepo: deps.sessionRepo, tenant: input.tenant });
    const context = buildPipelineContext({ input, session: loadedState });

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

    const quick = applyQuickAction(input.inboundText, guarded.state);
    if (quick.handled) {
        const quickOutbound = checkoutPostProcessForQuickAction({
            state: quick.state,
            outbound: quick.outbound,
        });
        await persistAndEmit({
            tenant: input.tenant,
            state: quick.state,
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
            nextState: quick.state,
            outbound: quickOutbound,
            sideEffects: [],
            metrics,
        };
    }

    const decision = await intentStage({
        intentService: deps.intentService,
        context,
        userText: input.inboundText,
    });

    // Prioridade: se está aguardando confirmação, resolve fechamento/erro de draft
    // antes de qualquer passagem por IA para evitar desvio de fluxo.
    const preOrder = await orderStage({
        orderService: deps.orderService,
        tenant: input.tenant,
        state: guarded.state,
        decision,
        userText: input.inboundText,
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
        const outbound: OutboundMessage[] = [
            { kind: "text", text: preOrder.outboundText },
            ...checkoutPostProcessForQuickAction({ state: preOrder.state, outbound: [] }),
        ];
        await persistAndEmit({
            tenant: input.tenant,
            state: preOrder.state,
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
            nextState: preOrder.state,
            outbound,
            sideEffects: [],
            metrics,
        };
    }

    const routed = routeStage({
        state: guarded.state,
        decision,
        inboundText: input.inboundText,
        tenant: input.tenant,
        flowCatalogId: input.flowCatalogId ?? null,
        flowStatusId: input.flowStatusId ?? null,
    });

    let nextState = routed.state;
    const outbound: OutboundMessage[] = [...routed.outbound];

    let invalidAiSanitized = false;
    let aiServiceErrorCode: string | undefined;
    if (routed.mode === "ai") {
        const ai = await aiStage({
            aiService: deps.aiService,
            context: { ...context, session: nextState },
            decision,
            userText: input.inboundText,
        });
        invalidAiSanitized = ai.invalidAiSanitized;
        aiServiceErrorCode = ai.aiResult.errorCode;
        nextState = ai.state;
        outbound.push(...ai.outbound);
    }
    const checkout = checkoutPostProcess({
        state: nextState,
        outbound,
        mode: routed.mode,
    });
    nextState = checkout.state;
    const finalOutbound = checkout.outbound;

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
    ];
    appendAiOutcomeMetrics(runMetrics, decision.intent, invalidAiSanitized, aiServiceErrorCode);

    flushPipelineRunMetrics(deps.metrics, input.tenant, runMetrics, new Set(["pro_pipeline.outbound_count"]));

    return {
        nextState,
        outbound: finalOutbound,
        sideEffects: [],
        metrics: runMetrics,
    };
}

