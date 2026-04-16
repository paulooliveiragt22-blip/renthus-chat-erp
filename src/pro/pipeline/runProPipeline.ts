import type {
    OutboundMessage,
    OrderDraft,
    ProPipelineInput,
    ProPipelineOutput,
    ProPipelineTelemetryReason,
    ProSessionState,
} from "@/src/types/contracts";
import { buildPipelineContext, type PipelineDependencies } from "./context";
import type { MetricsPort } from "../ports/metrics.port";
import { aiStage } from "./stages/aiStage";
import { guardRails } from "./stages/guardRails";
import { intentStage } from "./stages/intentStage";
import { loadState } from "./stages/loadState";
import { orderStage } from "./stages/orderStage";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";
import { persistAndEmit } from "./stages/persistAndEmit";
import { routeStage } from "./stages/routeStage";

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

function normalizeInboundAction(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "");
}

function parsePtMoneyInput(text: string): number | null {
    const only = text.replaceAll(/[^\d,.\s]/g, "").trim();
    if (!only) return null;
    const normalized = only
        .replaceAll(/\s+/g, "")
        .replaceAll(".", "")
        .replace(",", ".");
    const value = Number(normalized);
    if (!Number.isFinite(value) || value <= 0) return null;
    return Math.round(value * 100) / 100;
}

function buildPaymentButtons(): OutboundMessage {
    return {
        kind: "buttons",
        text: "Escolha a forma de pagamento:",
        buttons: [
            { id: "pro_pay_pix", title: "PIX" },
            { id: "pro_pay_card", title: "Cartao" },
            { id: "pro_pay_cash", title: "Dinheiro" },
        ],
    };
}

function buildConfirmationActionButtons(): OutboundMessage {
    return {
        kind: "buttons",
        text: "Escolha a proxima acao:",
        buttons: [
            { id: "pro_edit_order", title: "Editar" },
            { id: "pro_cancel_order", title: "Cancelar" },
            { id: "pro_confirm_order", title: "Confirmar" },
        ],
    };
}

function buildAddressConfirmationMessage(draft: OrderDraft): OutboundMessage[] {
    if (!draft.address) return [];
    if (!draft.address.enderecoClienteId) return [];
    const addr = [
        draft.address.logradouro,
        draft.address.numero,
        draft.address.complemento,
        draft.address.bairroLabel ?? draft.address.bairro,
        draft.address.cidade,
        draft.address.estado,
        draft.address.cep,
    ]
        .filter(Boolean)
        .join(", ");
    return [
        { kind: "text", text: `Endereco de entrega e este?\n${addr}\n\nSe nao for, digite o novo endereco.` },
        {
            kind: "buttons",
            text: "Confirma o endereco salvo?",
            buttons: [{ id: "pro_confirm_saved_address", title: "Confirmar endereco" }],
        },
    ];
}

function postProcessCheckoutMessages(state: ProSessionState): OutboundMessage[] {
    if (!state.draft) return [];
    const outbound: OutboundMessage[] = [];
    if (!state.draft.paymentMethod) {
        outbound.push(buildPaymentButtons());
        return outbound;
    }
    if (state.step === "pro_awaiting_confirmation") {
        outbound.push(buildConfirmationActionButtons());
    }
    return outbound;
}

function applyQuickAction(params: {
    text: string;
    state: ProSessionState;
}): {
    handled: boolean;
    state: ProSessionState;
    outbound: OutboundMessage[];
} {
    const { text, state } = params;
    const action = normalizeInboundAction(text);
    if (!action) return { handled: false, state, outbound: [] };

    if (action === "pro_cancel_order" || action === "btn_cancel_order") {
        return {
            handled: true,
            state: { ...state, step: "pro_idle", draft: null, misunderstandingStreak: 0, escalationTier: 0 },
            outbound: [{ kind: "text", text: "Pedido cancelado. Quando quiser, me diga o que precisa." }],
        };
    }

    if (action === "pro_edit_order" || action === "btn_edit_order") {
        return {
            handled: true,
            state: { ...state, step: "pro_collecting_order" },
            outbound: [{ kind: "text", text: "Perfeito. Me diga o que voce quer editar no pedido." }],
        };
    }

    if (action === "pro_add_items" || action === "btn_add_items") {
        return {
            handled: true,
            state: { ...state, step: "pro_collecting_order" },
            outbound: [{ kind: "text", text: "Certo. Me diga os produtos que quer adicionar." }],
        };
    }

    if (action === "pro_pay_pix" && state.draft) {
        return {
            handled: true,
            state: { ...state, step: "pro_collecting_order", draft: { ...state.draft, paymentMethod: "pix", changeFor: null } },
            outbound: [{ kind: "text", text: "Pagamento em PIX selecionado." }],
        };
    }
    if (action === "pro_pay_card" && state.draft) {
        return {
            handled: true,
            state: { ...state, step: "pro_collecting_order", draft: { ...state.draft, paymentMethod: "card", changeFor: null } },
            outbound: [{ kind: "text", text: "Pagamento em cartao selecionado." }],
        };
    }
    if (action === "pro_pay_cash" && state.draft) {
        return {
            handled: true,
            state: {
                ...state,
                step: "pro_awaiting_change_amount",
                draft: { ...state.draft, paymentMethod: "cash" },
            },
            outbound: [{ kind: "text", text: "Pagamento em dinheiro. Troco pra quanto?" }],
        };
    }

    if (state.step === "pro_awaiting_change_amount" && state.draft?.paymentMethod === "cash") {
        const amount = parsePtMoneyInput(text);
        if (amount != null) {
            return {
                handled: true,
                state: {
                    ...state,
                    step: "pro_collecting_order",
                    draft: { ...state.draft, changeFor: amount },
                },
                outbound: [{ kind: "text", text: `Troco registrado para R$ ${amount.toFixed(2).replace(".", ",")}.` }],
            };
        }
        return {
            handled: true,
            state,
            outbound: [{ kind: "text", text: "Nao entendi o valor do troco. Exemplo: 100,00." }],
        };
    }

    if (action === "pro_confirm_saved_address" && state.draft?.address) {
        return {
            handled: true,
            state: { ...state, step: "pro_collecting_order" },
            outbound: [{ kind: "text", text: "Endereco confirmado." }],
        };
    }

    return { handled: false, state, outbound: [] };
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

    const quick = applyQuickAction({ text: input.inboundText, state: guarded.state });
    if (quick.handled) {
        const quickOutbound = [...quick.outbound, ...postProcessCheckoutMessages(quick.state)];
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
            { name: "pro_pipeline.quick_action", value: 1, tags: { action: normalizeInboundAction(input.inboundText) } },
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
            ...postProcessCheckoutMessages(preOrder.state),
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

    if (routed.mode === "ai" && nextState.draft && nextState.step === "pro_collecting_order" && !nextState.draft.paymentMethod) {
        const needsAddressConfirmation = Boolean(nextState.draft.address?.enderecoClienteId);
        if (needsAddressConfirmation) {
            outbound.push(...buildAddressConfirmationMessage(nextState.draft));
        }
    }
    if (routed.mode === "ai" && nextState.draft && isDraftStructurallyCompleteForFinalize(nextState.draft)) {
        nextState = { ...nextState, step: "pro_awaiting_confirmation" };
    }
    outbound.push(...postProcessCheckoutMessages(nextState));

    await persistAndEmit({
        tenant: input.tenant,
        state: nextState,
        outbound,
        sessionRepo: deps.sessionRepo,
        messageGateway: deps.messageGateway,
        metrics: deps.metrics,
        logger: deps.logger,
    });

    const runMetrics: PipelineMetric[] = [
        ...preOrderSideMetrics,
        { name: "pro_pipeline.run", value: 1, tags: { intent: decision.intent } },
        { name: "pro_pipeline.outbound_count", value: outbound.length },
    ];
    appendAiOutcomeMetrics(runMetrics, decision.intent, invalidAiSanitized, aiServiceErrorCode);

    flushPipelineRunMetrics(deps.metrics, input.tenant, runMetrics, new Set(["pro_pipeline.outbound_count"]));

    return {
        nextState,
        outbound,
        sideEffects: [],
        metrics: runMetrics,
    };
}

