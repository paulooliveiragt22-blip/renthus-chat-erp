import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runProPipeline } from "../../src/pro/pipeline/runProPipeline";
import type { ProPipelineInput, ProSessionState } from "../../src/types/contracts";
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
        actor: {
            channel: "whatsapp",
            source: "meta_webhook",
            profileName: "Cliente",
        },
        tier: "pro",
        inboundText: "sim",
        nowIso: new Date().toISOString(),
    };
}

function stateAwaitingConfirmation(overrides: Partial<ProSessionState> = {}): ProSessionState {
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
                cidade: "Sorriso",
                estado: "MT",
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
        deliveryAddressUiConfirmed: true,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...overrides,
    };
}

function buildDeps(params: {
    session: ProSessionState;
    intent: "order_intent" | "greeting" | "unknown";
    aiResult?: unknown;
    onOrderCalled?: () => void;
}) {
    const logger: LoggerPort = {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    };
    const metrics: MetricsPort = {
        increment: () => undefined,
        timing: () => undefined,
    };
    let savedState: ProSessionState | null = null;
    const sessionRepo: SessionRepository = {
        load: async () => params.session,
        save: async (_c, _t, state) => {
            savedState = state;
        },
    };
    const sent: Array<{ kind?: string; text?: string; flow?: { flowId: string } }> = [];
    const messageGateway: MessageGateway = {
        send: async (_tenant, message) => {
            sent.push({
                kind: message.kind,
                text: message.text,
                flow: message.flow,
            });
        },
    };
    const intentService: IntentService = {
        classify: async () => ({
            intent: params.intent,
            confidence: "high",
            reasonCode: "llm_classification",
        }),
    };
    const aiService: AiService = {
        run: async () =>
            (params.aiResult ??
                {
                    action: "reply",
                    replyText: "ok",
                    signals: { toolRoundsUsed: 0 },
                }) as never,
    };
    const orderService: OrderService = {
        createFromDraft: async () => {
            params.onOrderCalled?.();
            return {
                ok: true,
                orderId: "o1",
                customerMessage: "pedido fechado",
                requireApproval: false,
            };
        },
    };

    return { logger, metrics, sessionRepo, messageGateway, intentService, aiService, orderService, sent, getSavedState: () => savedState };
}

describe("novo pipeline PRO - falhas reais", () => {
    it("IA retornando inválido: deve cair em fallback seguro", async () => {
        const deps = buildDeps({
            session: stateAwaitingConfirmation({ step: "pro_collecting_order" }),
            intent: "order_intent",
            aiResult: { action: "reply" }, // inválido (sem replyText/signals)
        });

        const out = await runProPipeline(
            { ...baseInput(), inboundText: "quero pedir" },
            deps
        );

        assert.ok(out.outbound.length > 0);
        assert.equal(typeof out.outbound[0]?.text, "string");
        assert.ok((out.outbound[0]?.text ?? "").length > 0);
    });

    it("intent errado: confirmação explícita deve finalizar pedido mesmo com intent incorreto", async () => {
        let called = 0;
        const deps = buildDeps({
            session: stateAwaitingConfirmation(),
            intent: "greeting", // errado
            onOrderCalled: () => {
                called += 1;
            },
        });

        await runProPipeline(baseInput(), deps);
        assert.equal(called, 1);
    });

    it("id de botão de confirmação (confirmar) deve finalizar pedido", async () => {
        let called = 0;
        const deps = buildDeps({
            session: stateAwaitingConfirmation(),
            intent: "unknown",
            onOrderCalled: () => {
                called += 1;
            },
        });

        await runProPipeline({ ...baseInput(), inboundText: "confirmar" }, deps);
        assert.equal(called, 1);
    });

    it("pedido vazio: não deve chamar orderService", async () => {
        let called = 0;
        const deps = buildDeps({
            session: stateAwaitingConfirmation({
                draft: {
                    items: [],
                    address: null,
                    paymentMethod: null,
                    changeFor: null,
                    deliveryFee: 0,
                    deliveryZoneId: null,
                    deliveryAddressText: null,
                    deliveryMinOrder: null,
                    deliveryEtaMin: null,
                    totalItems: 0,
                    grandTotal: 0,
                    pendingConfirmation: true,
                    version: 1,
                },
            }),
            intent: "order_intent",
            onOrderCalled: () => {
                called += 1;
            },
        });

        const out = await runProPipeline(baseInput(), deps);

        assert.equal(called, 0);
        assert.ok(out.outbound.some((m) => (m.text ?? "").toLowerCase().includes("pedido")));
    });

    it("greeting deve responder com menu de botões contextual", async () => {
        const deps = buildDeps({
            session: stateAwaitingConfirmation({ step: "pro_idle", customerId: null, draft: null }),
            intent: "greeting",
        });
        const out = await runProPipeline({ ...baseInput(), inboundText: "oi" }, deps);
        assert.ok(out.outbound.some((m) => m.kind === "buttons"));
        assert.ok(
            out.outbound.some((m) => (m.text ?? "").toLowerCase().includes("assistente") || (m.text ?? "").toLowerCase().includes("pedido"))
        );
    });

    it("botão Cardápio com flow configurado deve emitir mensagem kind flow", async () => {
        const deps = buildDeps({
            session: stateAwaitingConfirmation({ step: "pro_idle", customerId: null, draft: null }),
            intent: "order_intent",
        });
        const out = await runProPipeline(
            {
                ...baseInput(),
                inboundText: "btn_catalog",
                flowCatalogId: "FLOW_CATALOG_TEST",
            },
            deps
        );
        assert.ok(
            out.outbound.some((m) => m.kind === "flow" && m.flow?.flowId === "FLOW_CATALOG_TEST")
        );
    });

    it("botão de pagamento em dinheiro deve pedir troco", async () => {
        const deps = buildDeps({
            session: stateAwaitingConfirmation({
                step: "pro_awaiting_payment_method",
                draft: {
                    ...stateAwaitingConfirmation().draft!,
                    paymentMethod: null,
                },
            }),
            intent: "order_intent",
        });
        const out = await runProPipeline({ ...baseInput(), inboundText: "pro_pay_cash" }, deps);
        assert.equal(out.nextState.step, "pro_awaiting_change_amount");
        assert.ok(out.outbound.some((m) => (m.text ?? "").toLowerCase().includes("troco")));
    });
});

