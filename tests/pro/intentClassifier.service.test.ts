import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProIntentClassifierService } from "../../src/pro/services/intent/intentClassifier.service";
import type { PipelineContext } from "../../src/types/contracts";

function baseContext(step: PipelineContext["session"]["step"] = "pro_collecting_order"): PipelineContext {
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
        session: {
            step,
            customerId: "cust-1",
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: null,
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
        },
        policies: {
            locale: "pt-BR",
            maxToolRounds: 12,
            maxHistoryTurns: 24,
            aiTimeoutMs: 15_000,
            escalationRule: {
                unknownConsecutive: 2,
                lowConfidenceConsecutive: 2,
                noProgressTurns: 3,
            },
        },
        nowIso: new Date().toISOString(),
    };
}

describe("ProIntentClassifierService", () => {
    it("usa contexto de confirmação para manter order_intent", async () => {
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext("pro_awaiting_confirmation"),
            userText: "sim",
        });
        assert.equal(out.intent, "order_intent");
        assert.equal(out.reasonCode, "confirmation_shortcut");
    });

    it("mapeia botão de suporte para human_intent", async () => {
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext(),
            userText: "btn_support",
        });
        assert.equal(out.intent, "human_intent");
        assert.equal(out.reasonCode, "button_id_match");
    });

    it("resposta numerica curta em pedido activo mantém order_intent (sem menu inicial)", async () => {
        const prev = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext(),
            userText: "2",
        });
        if (prev) process.env.ANTHROPIC_API_KEY = prev;
        assert.equal(out.intent, "order_intent");
        assert.equal(out.reasonCode, "active_order_session");
    });

    it("uma caixa em coleta mantém order_intent (regressão menu saudação)", async () => {
        const prev = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext(),
            userText: "uma caixa",
        });
        if (prev) process.env.ANTHROPIC_API_KEY = prev;
        assert.equal(out.intent, "order_intent");
        assert.equal(out.reasonCode, "active_order_session");
    });

    it("com pedido activo ainda pode pedir status", async () => {
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext(),
            userText: "qual o status do meu pedido",
        });
        assert.equal(out.intent, "status_intent");
    });

    it("em pro_escalation_choice, cartão não vira human_intent (regressão handover)", async () => {
        const prev = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext("pro_escalation_choice"),
            userText: "cartão",
        });
        if (prev) process.env.ANTHROPIC_API_KEY = prev;
        assert.equal(out.intent, "order_intent");
        assert.equal(out.reasonCode, "regex_match");
    });

    it("cai em unknown quando ambíguo, sem pedido activo e sem chave de IA", async () => {
        const prev = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext("pro_idle"),
            userText: "hmm",
        });
        if (prev) process.env.ANTHROPIC_API_KEY = prev;
        assert.equal(out.intent, "unknown");
        assert.equal(out.reasonCode, "fallback_unknown");
    });
});

