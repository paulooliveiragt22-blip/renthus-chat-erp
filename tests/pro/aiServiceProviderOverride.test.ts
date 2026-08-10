import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiServiceAdapter } from "../../src/pro/adapters/ai/ai.service";
import type { AiServiceInput, PipelineContext } from "../../src/types/contracts";

/**
 * Fases 5/6 do plano multi-provider: `providerOverride` (por empresa) tem prioridade sobre
 * `LLM_PROVIDER` (env global) tanto na guarda de API key quanto no `providerOptions` passado ao
 * `generateText` — sem isso, o bug de parallel tool call (Fase 6) reapareceria pra empresas
 * OpenAI, e a guarda de key (Fase 5) continuaria "surda" ao override.
 */

function baseContext(): PipelineContext {
    return {
        tenant: { companyId: "c1", threadId: "t1", messageId: "m1", phoneE164: "+5511999999999" },
        actor: { channel: "whatsapp", source: "meta_webhook", profileName: "Cliente" },
        session: {
            step: "pro_collecting_order",
            customerId: null,
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: null,
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
            pendingPickGroups: [],
        },
        policies: {
            locale: "pt-BR",
            maxToolRounds: 8,
            maxHistoryTurns: 12,
            aiTimeoutMs: 5_000,
            llmEnabled: true,
            escalationRule: { unknownConsecutive: 2, lowConfidenceConsecutive: 2, noProgressTurns: 3 },
        },
        nowIso: new Date().toISOString(),
    };
}

function fakeAdmin(): SupabaseClient {
    return {} as unknown as SupabaseClient;
}

function baseInput(): AiServiceInput {
    return {
        context: baseContext(),
        userText: "oi",
        intentDecision: { intent: "greeting", confidence: "high", reasonCode: "regex_match" },
        draft: null,
        history: [],
        limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
    };
}

const zeroUsage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 0, text: 0, reasoning: undefined },
};

function respondResult() {
    return {
        content: [
            {
                type: "tool-call" as const,
                toolCallId: "c1",
                toolName: "respond_to_customer",
                input: JSON.stringify({ reply_text: "Oi! Como posso ajudar?" }),
            },
        ],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: zeroUsage,
        warnings: [],
    };
}

describe("AiServiceAdapter — providerOverride tem prioridade sobre env (Fases 5/6 do plano multi-provider)", () => {
    const prevProvider = process.env.LLM_PROVIDER;
    const prevAnthropicKey = process.env.ANTHROPIC_API_KEY;
    const prevOpenAiKey = process.env.OPENAI_API_KEY;

    afterEach(() => {
        const restore = (name: string, value: string | undefined) => {
            if (value === undefined) delete process.env[name];
            else process.env[name] = value;
        };
        restore("LLM_PROVIDER", prevProvider);
        restore("ANTHROPIC_API_KEY", prevAnthropicKey);
        restore("OPENAI_API_KEY", prevOpenAiKey);
    });

    it("guarda de API key usa providerOverride, não o env (Fase 5): env=anthropic sem key, override=openai com key → não bloqueia", async () => {
        process.env.LLM_PROVIDER = "anthropic";
        delete process.env.ANTHROPIC_API_KEY;
        process.env.OPENAI_API_KEY = "sk-test-fake-key";

        const model = new MockLanguageModelV3({ doGenerate: async () => respondResult() });
        const svc = new AiServiceAdapter(fakeAdmin(), { model, providerOverride: "openai" });

        const result = await svc.run(baseInput());
        assert.notEqual(result.action, "error", "não deveria cair no guard de API key ausente");
    });

    it("guarda de API key usa providerOverride, não o env (Fase 5): env=anthropic com key, override=openai sem key → bloqueia com AI_PROVIDER_ERROR", async () => {
        process.env.LLM_PROVIDER = "anthropic";
        process.env.ANTHROPIC_API_KEY = "sk-ant-test-fake-key";
        delete process.env.OPENAI_API_KEY;

        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                throw new Error("não deveria chamar generateText — guard deveria bloquear antes");
            },
        });
        const svc = new AiServiceAdapter(fakeAdmin(), { model, providerOverride: "openai" });

        const result = await svc.run(baseInput());
        assert.equal(result.action, "error");
        assert.equal((result as { errorCode?: string }).errorCode, "AI_PROVIDER_ERROR");
    });

    it("providerOptions (Fase 6): providerOverride=openai → parallelToolCalls:false, não disableParallelToolUse", async () => {
        process.env.LLM_PROVIDER = "anthropic"; // env diz o oposto — override deve vencer
        process.env.OPENAI_API_KEY = "sk-test-fake-key";

        const model = new MockLanguageModelV3({ doGenerate: async () => respondResult() });
        const svc = new AiServiceAdapter(fakeAdmin(), { model, providerOverride: "openai" });

        await svc.run(baseInput());

        const call = model.doGenerateCalls.at(-1);
        const opts = call?.providerOptions as Record<string, unknown> | undefined;
        assert.ok(opts?.openai, "esperava providerOptions.openai");
        assert.equal((opts?.openai as { parallelToolCalls?: boolean })?.parallelToolCalls, false);
        assert.equal(opts?.anthropic, undefined, "não deveria enviar chave anthropic pra chamada OpenAI");
    });

    it("providerOptions (Fase 6): providerOverride=anthropic (ou ausente) → disableParallelToolUse", async () => {
        process.env.LLM_PROVIDER = "anthropic";
        process.env.ANTHROPIC_API_KEY = "sk-ant-test-fake-key";

        const model = new MockLanguageModelV3({ doGenerate: async () => respondResult() });
        const svc = new AiServiceAdapter(fakeAdmin(), { model }); // sem override — comportamento atual (env)

        await svc.run(baseInput());

        const call = model.doGenerateCalls.at(-1);
        const opts = call?.providerOptions as Record<string, unknown> | undefined;
        assert.ok(opts?.anthropic, "esperava providerOptions.anthropic");
        assert.equal((opts?.anthropic as { disableParallelToolUse?: boolean })?.disableParallelToolUse, true);
        assert.equal(opts?.openai, undefined);
    });
});
