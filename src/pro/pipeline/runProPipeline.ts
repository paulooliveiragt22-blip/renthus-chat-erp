import type { OutboundMessage, ProPipelineInput, ProPipelineOutput } from "@/src/types/contracts";
import { buildPipelineContext, type PipelineDependencies } from "./context";
import { aiStage } from "./stages/aiStage";
import { guardRails } from "./stages/guardRails";
import { intentStage } from "./stages/intentStage";
import { loadState } from "./stages/loadState";
import { orderStage } from "./stages/orderStage";
import { persistAndEmit } from "./stages/persistAndEmit";
import { routeStage } from "./stages/routeStage";

export async function runProPipeline(
    input: ProPipelineInput,
    deps: PipelineDependencies
): Promise<ProPipelineOutput> {
    if (input.tier !== "pro") {
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
            metrics: [{ name: "pro_pipeline.skipped_non_pro", value: 1 }],
        };
    }

    const loadedState = await loadState({ sessionRepo: deps.sessionRepo, tenant: input.tenant });
    const context = buildPipelineContext({ input, session: loadedState });

    const guarded = guardRails({ state: context.session, inboundText: input.inboundText });
    if (guarded.stop) {
        return {
            nextState: guarded.state,
            outbound: guarded.outbound,
            sideEffects: [],
            metrics: [{ name: "pro_pipeline.guard_stop", value: 1 }],
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
    if (preOrder.outboundText) {
        const outbound: OutboundMessage[] = [{ kind: "text", text: preOrder.outboundText }];
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
            { name: "pro_pipeline.pre_order_resolved", value: 1, tags: { intent: decision.intent } },
        ];
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
    });

    let nextState = routed.state;
    const outbound: OutboundMessage[] = [...routed.outbound];

    if (routed.mode === "ai") {
        const ai = await aiStage({
            aiService: deps.aiService,
            context: { ...context, session: nextState },
            decision,
            userText: input.inboundText,
        });
        nextState = ai.state;
        outbound.push(...ai.outbound);
    }

    await persistAndEmit({
        tenant: input.tenant,
        state: nextState,
        outbound,
        sessionRepo: deps.sessionRepo,
        messageGateway: deps.messageGateway,
        metrics: deps.metrics,
        logger: deps.logger,
    });

    return {
        nextState,
        outbound,
        sideEffects: [],
        metrics: [
            { name: "pro_pipeline.run", value: 1, tags: { intent: decision.intent } },
            { name: "pro_pipeline.outbound_count", value: outbound.length },
        ],
    };
}

