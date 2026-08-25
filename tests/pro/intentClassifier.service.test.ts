import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ProIntentClassifierService } from "../../src/pro/services/intent/intentClassifier.service";
import type { PipelineContext } from "../../src/types/contracts";

function baseContext(
    step: PipelineContext["session"]["step"] = "pro_collecting_order",
    opts?: { llmEnabled?: boolean }
): PipelineContext {
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
            llmEnabled: opts?.llmEnabled ?? true,
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

    it("ambíguo com IA ligada: defer_to_agent (sem Haiku no classificador)", async () => {
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext("pro_idle", { llmEnabled: true }),
            userText: "hmm",
        });
        assert.equal(out.intent, "unknown");
        assert.equal(out.reasonCode, "defer_to_agent");
    });

    it("cai em unknown quando ambíguo, sem pedido activo e IA off", async () => {
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext("pro_idle", { llmEnabled: false }),
            userText: "hmm",
        });
        assert.equal(out.intent, "unknown");
        assert.equal(out.reasonCode, "fallback_unknown");
    });

    it("com IA ligada: 'quero uma coca' usa regex order_intent (sem classificador LLM)", async () => {
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext("pro_idle", { llmEnabled: true }),
            userText: "quero uma coca",
        });
        assert.equal(out.intent, "order_intent");
        assert.equal(out.reasonCode, "regex_match");
    });

    it("com IA ligada: FAQ 'quanto custa' defer_to_agent", async () => {
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext("pro_idle", { llmEnabled: true }),
            userText: "quanto custa a entrega?",
        });
        assert.equal(out.intent, "faq");
        assert.equal(out.reasonCode, "defer_to_agent");
    });

    it("degradado (llm off): saudação via regex", async () => {
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext("pro_idle", { llmEnabled: false }),
            userText: "oi",
        });
        assert.equal(out.intent, "greeting");
        assert.equal(out.reasonCode, "regex_match");
    });

    it("com LLM ligado (mesmo sem chave/provider fora do ar): oi usa regex de greeting, não depende de IA", async () => {
        const prevA = process.env.ANTHROPIC_API_KEY;
        const prevO = process.env.OPENAI_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;
        const svc = new ProIntentClassifierService();
        const out = await svc.classify({
            context: baseContext("pro_idle", { llmEnabled: true }),
            userText: "oi",
        });
        if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
        if (prevO) process.env.OPENAI_API_KEY = prevO;
        assert.equal(out.intent, "greeting");
        assert.equal(out.reasonCode, "regex_match");
    });

    it("oi com lastSearchPicks residual (sem draft) → greeting, não order_intent", async () => {
        const svc = new ProIntentClassifierService();
        const ctx = baseContext("pro_collecting_order", { llmEnabled: true });
        ctx.session.lastSearchPicks = [
            { embalagemId: "a", label: "SALGADINHO" },
            { embalagemId: "b", label: "CX" },
        ];
        const out = await svc.classify({ context: ctx, userText: "oi" });
        assert.equal(out.intent, "greeting");
        assert.equal(out.reasonCode, "regex_match");
    });

    /**
     * Regressão do caso real (empresa Ferrester, provider openai fora do ar):
     * "oii" (variação coloquial com vogal repetida) não batia na regex antiga
     * `^(?:oi|...)$` e caía no LLM — se o provider falhasse, o cliente recebia
     * o erro genérico ("Tive uma falha...") em vez do menu de boas-vindas.
     */
    for (const variant of ["oii", "oiii", "olaa", "olá", "opa", "eae", "e ai", "alô"]) {
        it(`variação coloquial "${variant}" também usa regex de greeting, não depende de IA`, async () => {
            const prevA = process.env.ANTHROPIC_API_KEY;
            const prevO = process.env.OPENAI_API_KEY;
            delete process.env.ANTHROPIC_API_KEY;
            delete process.env.OPENAI_API_KEY;
            const svc = new ProIntentClassifierService();
            const out = await svc.classify({
                context: baseContext("pro_idle", { llmEnabled: true }),
                userText: variant,
            });
            if (prevA) process.env.ANTHROPIC_API_KEY = prevA;
            if (prevO) process.env.OPENAI_API_KEY = prevO;
            assert.equal(out.intent, "greeting");
            assert.equal(out.reasonCode, "regex_match");
        });
    }
});

