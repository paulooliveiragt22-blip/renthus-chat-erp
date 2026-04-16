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

    it("nao trata resposta numerica solta como botao de status", async () => {
        const prev = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext(),
            userText: "2",
        });
        if (prev) process.env.ANTHROPIC_API_KEY = prev;
        assert.equal(out.intent, "unknown");
        assert.equal(out.reasonCode, "fallback_unknown");
    });

    it("cai em unknown quando ambíguo e sem chave de IA", async () => {
        const prev = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext(),
            userText: "hmm",
        });
        if (prev) process.env.ANTHROPIC_API_KEY = prev;
        assert.equal(out.intent, "unknown");
        assert.equal(out.reasonCode, "fallback_unknown");
    });
});

