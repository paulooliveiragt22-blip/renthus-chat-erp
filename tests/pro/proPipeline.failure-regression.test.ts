import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProPipelineSessionLoadError } from "../../src/pro/pipeline/errors";
import { runProPipeline } from "../../src/pro/pipeline/runProPipeline";
import type { OrderServiceResult, ProPipelineInput, ProSessionState } from "../../src/types/contracts";
import type { LoggerPort } from "../../src/pro/ports/logger.port";
import type { MessageGateway } from "../../src/pro/ports/message.gateway";
import type { MetricsPort } from "../../src/pro/ports/metrics.port";
import type { SessionRepository } from "../../src/pro/ports/session.repository";
import type { AiService } from "../../src/pro/services/ai/ai.types";
import type { IntentService } from "../../src/pro/services/intent/intent.types";
import type { OrderService } from "../../src/pro/services/order/order.types";

function baseInput(): ProPipelineInput {
    return {
        tenant: {
            companyId: "c1",
            threadId: "t1",
            messageId: "m1",
            phoneE164: "+5511999999999",
        },
        actor: { channel: "whatsapp", source: "meta_webhook", profileName: "Cliente" },
        tier: "pro",
        inboundText: "sim",
        nowIso: new Date().toISOString(),
    };
}

function baseState(): ProSessionState {
    return {
        step: "pro_collecting_order",
        customerId: "cust-1",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
    };
}

function stateAwaitingConfirmation(): ProSessionState {
    return {
        step: "pro_awaiting_confirmation",
        customerId: "cust-1",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: {
            items: [
                {
                    produtoEmbalagemId: "pe-1",
                    productName: "Heineken",
                    quantity: 2,
                    unitPrice: 10,
                    fatorConversao: 1,
                    productVolumeId: "pv-1",
                    estoqueUnidades: 30,
                },
            ],
            address: {
                logradouro: "Rua A",
                numero: "10",
                bairro: "Centro",
                complemento: null,
            },
            paymentMethod: "pix",
            changeFor: null,
            deliveryFee: 5,
            deliveryZoneId: "z1",
            deliveryAddressText: "Rua A, 10, Centro",
            deliveryMinOrder: null,
            deliveryEtaMin: 30,
            totalItems: 20,
            grandTotal: 25,
            pendingConfirmation: true,
            version: 1,
        },
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
    };
}

function deps(params: {
    state?: ProSessionState;
    intent?: "order_intent" | "greeting" | "unknown";
    aiResult?: unknown;
    onOrderCalled?: () => void;
    orderResult?: OrderServiceResult;
    sessionRepo?: SessionRepository;
    metricsIncrements?: Array<{ name: string; value?: number; tags?: Record<string, string> }>;
}) {
    const session = params.state ?? baseState();
    const logger: LoggerPort = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const metrics: MetricsPort = {
        increment: (name, value, tags) => {
            params.metricsIncrements?.push({ name, value, tags });
        },
        timing: () => undefined,
    };
    const sessionRepo: SessionRepository = params.sessionRepo ?? {
        load: async () => session,
        save: async () => undefined,
    };
    const messageGateway: MessageGateway = { send: async () => undefined };
    const intentService: IntentService = {
        classify: async () => ({
            intent: params.intent ?? "order_intent",
            confidence: "high",
            reasonCode: "llm_classification",
        }),
    };
    const aiService: AiService = {
        run: async () =>
            (params.aiResult ?? {
                action: "reply",
                replyText: "ok",
                signals: { toolRoundsUsed: 0 },
            }) as never,
    };
    const orderService: OrderService = {
        createFromDraft: async () => {
            params.onOrderCalled?.();
            if (params.orderResult !== undefined) {
                return params.orderResult;
            }
            return {
                ok: true,
                orderId: "o1",
                customerMessage: "pedido fechado",
                requireApproval: false,
            };
        },
    };
    return { logger, metrics, sessionRepo, messageGateway, intentService, aiService, orderService };
}

describe("pro pipeline - failure regression", () => {
    it("IA TOOL_FAILED: métrica ai_tool_round_exhausted quando adapter devolve erro de ferramentas", async () => {
        const out = await runProPipeline(
            { ...baseInput(), inboundText: "quero 2 skol" },
            deps({
                state: baseState(),
                intent: "order_intent",
                aiResult: {
                    action: "error",
                    replyText: "Limite de ferramentas.",
                    signals: { toolRoundsUsed: 12, intentMarker: "unknown" },
                    errorCode: "TOOL_FAILED",
                },
            })
        );
        assert.ok(
            out.metrics.some(
                (m) => m.name === "pro_pipeline.ai_tool_round_exhausted" && m.tags?.reason === "tool_output_rejected"
            )
        );
    });

    it("ia timeout: deve retornar mensagem segura", async () => {
        const out = await runProPipeline(
            { ...baseInput(), inboundText: "quero pedir" },
            deps({
                aiResult: {
                    action: "error",
                    replyText: "A IA demorou para responder. Tente novamente em instantes.",
                    errorCode: "AI_TIMEOUT",
                    signals: { toolRoundsUsed: 0, intentMarker: "unknown" },
                },
            })
        );
        assert.ok(out.outbound.some((m) => (m.text ?? "").toLowerCase().includes("tente novamente")));
        assert.ok(
            out.metrics.some((m) => m.name === "pro_pipeline.ai_timeout" && m.tags?.reason === "ai_timeout")
        );
    });

    it("IA rate limit: emite métrica ai_rate_limited", async () => {
        const out = await runProPipeline(
            { ...baseInput(), inboundText: "quero pedir" },
            deps({
                aiResult: {
                    action: "error",
                    replyText: "Estamos com pico de uso na IA. Aguarde um instante e tente de novo.",
                    errorCode: "AI_RATE_LIMIT",
                    signals: { toolRoundsUsed: 0, intentMarker: "unknown" },
                },
            })
        );
        assert.ok(
            out.metrics.some((m) => m.name === "pro_pipeline.ai_rate_limited" && m.tags?.reason === "ai_rate_limited")
        );
    });

    it("IA retornando inválido (sem replyText): aiStage aplica fallback seguro", async () => {
        const out = await runProPipeline(
            { ...baseInput(), inboundText: "quero 2 skol" },
            deps({
                state: baseState(),
                intent: "order_intent",
                aiResult: { action: "reply" },
            })
        );
        assert.ok(out.outbound.length > 0);
        const t = out.outbound[0]?.text ?? "";
        assert.ok(t.length > 0);
        assert.ok(
            t.toLowerCase().includes("falha") ||
                t.toLowerCase().includes("novamente") ||
                t.toLowerCase().includes("tentar")
        );
        assert.ok(
            out.metrics.some(
                (m) => m.name === "pro_pipeline.ai_invalid_response" && m.tags?.reason === "ai_invalid_response"
            )
        );
    });

    it("IA retornando JSON inválido (payload string quebrada): pipeline não quebra e aplica fallback", async () => {
        const out = await runProPipeline(
            { ...baseInput(), inboundText: "quero 1 heineken" },
            deps({
                state: baseState(),
                intent: "order_intent",
                // Simula provider devolvendo payload fora do contrato esperado.
                aiResult: "{\"action\":\"reply\",\"replyText\":",
            })
        );
        assert.ok(out.outbound.length > 0);
        assert.ok(
            out.metrics.some(
                (m) => m.name === "pro_pipeline.ai_invalid_response" && m.tags?.reason === "ai_invalid_response"
            )
        );
    });

    it("item inexistente no fecho: PRODUCT_NOT_FOUND expõe mensagem e métrica order_failed", async () => {
        const out = await runProPipeline(baseInput(), deps({
            state: stateAwaitingConfirmation(),
            intent: "greeting",
            orderResult: {
                ok: false,
                customerMessage: "Nao encontramos esse produto ou embalagem no catalogo.",
                errorCode: "PRODUCT_NOT_FOUND",
                retryable: false,
            },
        }));
        assert.ok(out.outbound.some((m) => (m.text ?? "").includes("Nao encontramos")));
        assert.ok(
            out.metrics.some(
                (m) => m.name === "pro_pipeline.order_failed" && m.tags?.errorCode === "PRODUCT_NOT_FOUND"
            )
        );
    });

    it("falha de DB / persistência no fecho: DB_ERROR retorna mensagem retryable", async () => {
        const out = await runProPipeline(baseInput(), deps({
            state: stateAwaitingConfirmation(),
            intent: "order_intent",
            orderResult: {
                ok: false,
                customerMessage: "Erro ao gravar. Tente novamente.",
                errorCode: "DB_ERROR",
                retryable: true,
            },
        }));
        assert.ok(out.outbound.some((m) => (m.text ?? "").includes("Erro ao gravar")));
        assert.ok(
            out.metrics.some((m) => m.name === "pro_pipeline.order_failed" && m.tags?.errorCode === "DB_ERROR")
        );
    });

    it("dados inconsistentes no fecho: INCONSISTENT_DRAFT retorna erro explícito", async () => {
        const out = await runProPipeline(baseInput(), deps({
            state: stateAwaitingConfirmation(),
            intent: "order_intent",
            orderResult: {
                ok: false,
                customerMessage: "Dados inconsistentes do pedido. Revise os itens e tente novamente.",
                errorCode: "INCONSISTENT_DRAFT",
                retryable: false,
            },
        }));
        assert.ok(out.outbound.some((m) => (m.text ?? "").includes("Dados inconsistentes")));
        assert.ok(
            out.metrics.some(
                (m) => m.name === "pro_pipeline.order_failed" && m.tags?.errorCode === "INCONSISTENT_DRAFT"
            )
        );
    });

    it("falha de DB ao carregar sessão: runProPipeline propaga ProPipelineSessionLoadError com underlyingCause", async () => {
        const brokenRepo: SessionRepository = {
            load: async () => {
                throw new Error("supabase_read_failed");
            },
            save: async () => undefined,
        };
        await assert.rejects(
            async () =>
                runProPipeline(
                    { ...baseInput(), inboundText: "oi" },
                    deps({ sessionRepo: brokenRepo })
                ),
            (err: unknown) => {
                assert.ok(isProPipelineSessionLoadError(err));
                assert.equal(err.code, "SESSION_LOAD_FAILED");
                const c = err.underlyingCause;
                assert.ok(c instanceof Error && /supabase_read_failed/.test(c.message));
                return true;
            }
        );
    });

    it("sem rascunho na confirmação: não chama pedido e métrica finalize_blocked", async () => {
        let orderCalls = 0;
        const noDraft = stateAwaitingConfirmation();
        noDraft.draft = null;
        const out = await runProPipeline(baseInput(), deps({
            state: noDraft,
            intent: "order_intent",
            onOrderCalled: () => {
                orderCalls += 1;
            },
        }));
        assert.equal(orderCalls, 0);
        assert.ok(out.outbound.some((m) => (m.text ?? "").toLowerCase().includes("rascunho")));
        assert.ok(
            out.metrics.some(
                (m) =>
                    m.name === "pro_pipeline.order_precondition_failed" &&
                    m.tags?.reason === "finalize_blocked"
            )
        );
    });

    it("rascunho incompleto na confirmação: não chama pedido e métrica order_precondition_failed", async () => {
        let orderCalls = 0;
        const incomplete = stateAwaitingConfirmation();
        const draft = incomplete.draft;
        if (!draft) {
            throw new Error("draft esperado no cenário de awaiting_confirmation");
        }
        incomplete.draft = {
            ...draft,
            items: [],
            address: draft.address,
            paymentMethod: draft.paymentMethod,
            totalItems: 0,
            grandTotal: draft.deliveryFee ?? 0,
        };
        const out = await runProPipeline(baseInput(), deps({
            state: incomplete,
            intent: "order_intent",
            onOrderCalled: () => {
                orderCalls += 1;
            },
        }));
        assert.equal(orderCalls, 0);
        assert.ok(out.outbound.some((m) => (m.text ?? "").toLowerCase().includes("incompleto")));
        assert.ok(
            out.metrics.some(
                (m) =>
                    m.name === "pro_pipeline.order_precondition_failed" &&
                    m.tags?.reason === "draft_validation_failed"
            )
        );
    });

    it("confirmação fraca (não explícita): não fecha pedido e emite confirmation_ambiguous", async () => {
        let orderCalls = 0;
        const out = await runProPipeline(
            { ...baseInput(), inboundText: "talvez depois" },
            deps({
                state: stateAwaitingConfirmation(),
                intent: "order_intent",
                onOrderCalled: () => {
                    orderCalls += 1;
                },
            })
        );
        assert.equal(orderCalls, 0);
        assert.ok(
            out.metrics.some(
                (m) => m.name === "pro_pipeline.confirmation_ambiguous" && m.tags?.reason === "confirmation_ambiguous"
            )
        );
        assert.ok(out.outbound.length > 0);
    });

    it("negação em awaiting_confirmation não deve fechar pedido", async () => {
        let orderCalls = 0;
        const out = await runProPipeline(
            { ...baseInput(), inboundText: "não confirma ainda" },
            deps({
                state: stateAwaitingConfirmation(),
                intent: "order_intent",
                onOrderCalled: () => {
                    orderCalls += 1;
                },
            })
        );
        assert.equal(orderCalls, 0);
        assert.ok(
            out.metrics.some(
                (m) => m.name === "pro_pipeline.confirmation_ambiguous" && m.tags?.reason === "confirmation_ambiguous"
            )
        );
    });

    it("falha de DB ao gravar sessão: persistAndEmit incrementa session_save_failed e propaga", async () => {
        const metricsIncrements: Array<{ name: string; tags?: Record<string, string> }> = [];
        const flakyRepo: SessionRepository = {
            load: async () => baseState(),
            save: async () => {
                throw new Error("supabase_write_failed");
            },
        };
        await assert.rejects(
            async () =>
                runProPipeline(
                    { ...baseInput(), inboundText: "quero uma cerveja" },
                    deps({
                        state: baseState(),
                        intent: "order_intent",
                        sessionRepo: flakyRepo,
                        metricsIncrements,
                    })
                ),
            /supabase_write_failed/
        );
        assert.ok(metricsIncrements.some((m) => m.name === "pro_pipeline.session_save_failed"));
    });
});

