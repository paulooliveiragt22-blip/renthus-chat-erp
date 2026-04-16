import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
    };
}

function deps(params: {
    state?: ProSessionState;
    intent?: "order_intent" | "greeting" | "unknown";
    aiResult?: unknown;
    onOrderCalled?: () => void;
    orderResult?: OrderServiceResult;
    sessionRepo?: SessionRepository;
}) {
    const session = params.state ?? baseState();
    const logger: LoggerPort = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const metrics: MetricsPort = { increment: () => undefined, timing: () => undefined };
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

    it("falha de DB ao carregar sessão: runProPipeline propaga erro (sem mascarar 200)", async () => {
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
            /supabase_read_failed/
        );
    });
});

