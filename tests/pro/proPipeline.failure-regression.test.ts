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

function deps(params: {
    state?: ProSessionState;
    intent?: "order_intent" | "greeting" | "unknown";
    aiResult?: unknown;
    onOrderCalled?: () => void;
}) {
    const session = params.state ?? baseState();
    const logger: LoggerPort = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const metrics: MetricsPort = { increment: () => undefined, timing: () => undefined };
    const sessionRepo: SessionRepository = {
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
});

