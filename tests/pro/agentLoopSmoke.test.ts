/**
 * Smoke do agent-loop-only: FAQ/qty/pay/confirm e add-more sem segundo cérebro.
 * AI mock simula prepare no servidor (estado draft), UI vem do checkoutPostProcess.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runProPipeline } from "../../src/pro/pipeline/runProPipeline";
import { checkoutPostProcessForQuickAction } from "../../src/pro/pipeline/stages/checkoutPostProcess";
import { withResolvedSlotStep } from "../../src/pro/pipeline/orderSlotStep";
import type { OrderDraft, ProPipelineInput, ProSessionState } from "../../src/types/contracts";
import type { LoggerPort } from "../../src/pro/ports/logger.port";
import type { MessageGateway } from "../../src/pro/ports/message.gateway";
import type { MetricsPort } from "../../src/pro/ports/metrics.port";
import type { SessionRepository } from "../../src/pro/ports/session.repository";
import type { AiService } from "../../src/pro/services/ai/ai.types";
import type { IntentService } from "../../src/pro/services/intent/intent.types";
import type { OrderService } from "../../src/pro/services/order/order.types";

function baseInput(text: string): ProPipelineInput {
    return {
        tenant: {
            companyId: "c1",
            threadId: "t1",
            messageId: "m1",
            phoneE164: "+5511999999999",
        },
        actor: { channel: "whatsapp", source: "meta_webhook", profileName: "Cliente" },
        tier: "pro",
        inboundText: text,
        nowIso: new Date().toISOString(),
        aiCapability: {
            tier: "avancado",
            maxToolRounds: 8,
            maxHistoryTurns: 24,
            aiTimeoutMs: 15_000,
            llmEnabled: true,
            model: "test",
        },
    };
}

function item(id: string, name: string, qty = 1, price = 10): OrderDraft["items"][number] {
    return {
        produtoEmbalagemId: id,
        productName: name,
        quantity: qty,
        unitPrice: price,
        fatorConversao: 1,
        productVolumeId: null,
        estoqueUnidades: 9,
    };
}

function completeDraft(overrides: Partial<OrderDraft> = {}): OrderDraft {
    const items = overrides.items ?? [item("coca", "Coca 2L", 2, 12)];
    const totalItems = items.reduce((s, i) => s + i.unitPrice * i.quantity, 0);
    return {
        items,
        address: {
            logradouro: "Rua A",
            numero: "1",
            bairro: "Centro",
            cidade: "Sorriso",
            estado: "MT",
            complemento: null,
        },
        paymentMethod: "pix",
        changeFor: null,
        fulfillmentType: "delivery",
        deliveryFee: 5,
        deliveryZoneId: "z1",
        deliveryAddressText: "Rua A, 1",
        deliveryMinOrder: null,
        deliveryEtaMin: null,
        totalItems,
        grandTotal: totalItems + 5,
        pendingConfirmation: true,
        version: 1,
        ...overrides,
    };
}

function session(overrides: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_collecting_order",
        customerId: "cust-1",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        deliveryAddressUiConfirmed: false,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...overrides,
    };
}

function buildDeps(params: {
    session: ProSessionState;
    intent?: string;
    aiDraft?: OrderDraft | null;
    onOrder?: () => void;
}) {
    let saved = params.session;
    const logger: LoggerPort = {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
    };
    const metrics: MetricsPort = { increment: () => undefined, timing: () => undefined };
    const sessionRepo: SessionRepository = {
        load: async () => saved,
        save: async (_companyId, _threadId, s) => {
            saved = s;
        },
    };
    const messageGateway: MessageGateway = { send: async () => undefined };
    const intentService: IntentService = {
        classify: async () => ({
            intent: (params.intent ?? "order_intent") as never,
            confidence: "high",
            reasonCode: "llm_classification",
        }),
    };
    const aiService: AiService = {
        run: async (input) => ({
            action: "reply",
            replyText: "Certo!",
            updatedDraft: params.aiDraft !== undefined ? params.aiDraft : input.draft,
            updatedHistory: input.history,
            signals: { toolRoundsUsed: 1, intentMarker: "ok" },
        }),
    };
    const orderService: OrderService = {
        createFromDraft: async () => {
            params.onOrder?.();
            return {
                ok: true,
                orderId: "o1",
                customerMessage: "pedido fechado",
                requireApproval: false,
            };
        },
    };
    return {
        logger,
        metrics,
        sessionRepo,
        messageGateway,
        intentService,
        aiService,
        orderService,
        getSaved: () => saved,
    };
}

describe("agent loop smoke", () => {
    it("FAQ+qty: AI devolve draft parcial → UI de endereço/pagamento sem extract", async () => {
        const partial = completeDraft({ paymentMethod: null, pendingConfirmation: false });
        const deps = buildDeps({
            session: session({
                searchProdutoEmbalagemIds: ["coca"],
                lastSearchPicks: [{ embalagemId: "coca", label: "Coca 2L" }],
            }),
            intent: "order_intent",
            aiDraft: partial,
        });
        const out = await runProPipeline(baseInput("quero 2"), deps);
        assert.ok(out.nextState.draft?.items?.length);
        assert.equal(out.nextState.draft?.paymentMethod ?? null, null);
        /** Sem pagamento inventado. */
        assert.ok(
            !out.outbound.some((m) => /pix|r\$\s*2(?!,)/i.test(String(m.text ?? "")) && !m.buttons)
        );
    });

    it("pay → confirm: botões estruturados fecham pedido", async () => {
        let ordered = 0;
        const d = completeDraft({ paymentMethod: null });
        const afterAddr = withResolvedSlotStep(
            session({
                draft: d,
                deliveryAddressUiConfirmed: true,
                step: "pro_awaiting_payment_method",
            })
        );
        const payOut = checkoutPostProcessForQuickAction({
            state: {
                ...afterAddr,
                draft: { ...d, paymentMethod: "pix" },
            },
            outbound: [],
        });
        assert.ok(
            payOut.some((m) => m.buttons?.some((b) => b.id === "pro_confirm_order")) ||
                withResolvedSlotStep({
                    ...afterAddr,
                    draft: { ...d, paymentMethod: "pix" },
                    deliveryAddressUiConfirmed: true,
                }).step === "pro_awaiting_confirmation"
        );

        const deps = buildDeps({
            session: session({
                step: "pro_awaiting_confirmation",
                deliveryAddressUiConfirmed: true,
                draft: completeDraft(),
            }),
            intent: "unknown",
            onOrder: () => {
                ordered += 1;
            },
        });
        await runProPipeline(baseInput("pro_confirm_order"), deps);
        assert.equal(ordered, 1);
    });

    it("add-more: hold + prepare aditivo não gruda Pix fantasma", async () => {
        const deps = buildDeps({
            session: session({
                checkoutEditHold: true,
                deliveryAddressUiConfirmed: true,
                draft: completeDraft({ paymentMethod: null }),
                searchProdutoEmbalagemIds: ["coca"],
            }),
            intent: "order_intent",
            aiDraft: completeDraft({
                paymentMethod: null,
                items: [item("coca", "Coca 2L", 3, 12)],
            }),
        });
        const out = await runProPipeline(baseInput("mais uma"), deps);
        assert.equal(out.nextState.draft?.paymentMethod ?? null, null);
        assert.ok((out.nextState.draft?.items?.[0]?.quantity ?? 0) >= 2);
    });

    it("multi-item: prosa não finaliza; só botão Confirmar", async () => {
        let ordered = 0;
        const deps = buildDeps({
            session: session({
                step: "pro_awaiting_confirmation",
                deliveryAddressUiConfirmed: true,
                draft: completeDraft({
                    items: [item("a", "Heineken", 2, 8), item("b", "Salgadinho", 1, 15)],
                }),
            }),
            intent: "order_intent",
            onOrder: () => {
                ordered += 1;
            },
        });
        await runProPipeline(baseInput("sim pode fechar"), deps);
        assert.equal(ordered, 0);
        await runProPipeline(baseInput("pro_confirm_order"), deps);
        assert.equal(ordered, 1);
    });
});
