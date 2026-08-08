import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiServiceAdapter } from "../../src/pro/adapters/ai/ai.service";
import type { CatalogPort } from "../../src/pro/ports/catalog.port";
import type { OrderDraftPort } from "../../src/pro/ports/orderDraft.port";
import type { AiServiceInput, PipelineContext } from "../../src/types/contracts";

/**
 * Regressão do bug real de smoke: "quero skol e original" (2 produtos ambíguos na mesma
 * mensagem) resolvia só "original" — "skol" sumia silenciosamente do pedido porque nada
 * forçava o modelo a retomar o item não buscado. Ver docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md.
 */

function baseContext(pendingOrderMentions: string[] = []): PipelineContext {
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
            pendingOrderMentions,
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

function fakeAdminWithSiglas(): SupabaseClient {
    const builder = {
        select() {
            return builder;
        },
        eq() {
            return builder;
        },
        order() {
            return Promise.resolve({ data: [], error: null });
        },
    };
    return {
        from() {
            return builder;
        },
    } as unknown as SupabaseClient;
}

function catalogEmpty(): CatalogPort {
    return {
        async searchDetailed() {
            return { items: [], didYouMean: [], empty: true, queryNormalized: "skol" };
        },
    };
}

function untouchableOrderDraft(): OrderDraftPort {
    return {
        prepareFromToolInput: async () => {
            throw new Error("este teste não deveria chamar prepare_order_draft");
        },
    };
}

const zeroUsage = {
    inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: 0, text: 0, reasoning: undefined },
};

function toolCallResult(toolCallId: string, toolName: string, input: unknown) {
    return {
        content: [{ type: "tool-call" as const, toolCallId, toolName, input: JSON.stringify(input) }],
        finishReason: { unified: "tool-calls" as const, raw: undefined },
        usage: zeroUsage,
        warnings: [],
    };
}

describe("AiServiceAdapter — pendingOrderMentions (item citado e não buscado)", () => {
    it("força search_produtos antes de deixar o modelo fechar o turno com item pendente", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                if (callCount === 1) {
                    // Modelo tenta fechar direto, sem se preocupar com o "skol" pendente.
                    return toolCallResult("c1", "respond_to_customer", {
                        reply_text: "Aqui está sua Original!",
                    });
                }
                if (callCount === 2) {
                    // Nudge forçou search_produtos — modelo busca o termo pendente.
                    return toolCallResult("c2", "search_produtos", { query: "skol" });
                }
                // Resolvido (ou não): modelo fecha o turno de novo.
                return toolCallResult("c3", "respond_to_customer", {
                    reply_text: "Não achei mais opções de skol, só a Original ficou no pedido.",
                });
            },
        });

        const svc = new AiServiceAdapter({} as SupabaseClient, {
            model,
            catalog: catalogEmpty(),
            orderDraft: untouchableOrderDraft(),
        });

        const input: AiServiceInput = {
            context: baseContext(["skol"]),
            userText: "pro_pick_emb:original-60ml",
            intentDecision: { intent: "greeting", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
        };

        const result = await svc.run(input);

        assert.equal(callCount, 3, "esperava 3 chamadas ao modelo (respond → nudge search → respond final)");
        assert.deepEqual(model.doGenerateCalls[1]?.toolChoice, {
            type: "tool",
            toolName: "search_produtos",
        });
        assert.equal(result.action !== "error", true);
        assert.match(result.replyText, /skol/i);
    });

    it("sem pendingOrderMentions, não força search extra (comportamento normal preservado)", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                return toolCallResult("c1", "respond_to_customer", { reply_text: "Oi! Tudo certo?" });
            },
        });

        const svc = new AiServiceAdapter({} as SupabaseClient, {
            model,
            catalog: catalogEmpty(),
            orderDraft: untouchableOrderDraft(),
        });

        const input: AiServiceInput = {
            context: baseContext([]),
            userText: "oi",
            intentDecision: { intent: "greeting", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
        };

        const result = await svc.run(input);
        assert.equal(callCount, 1);
        assert.equal(result.action, "reply");
    });

    it("propaga pending_items declarados pelo modelo para updatedPendingOrderMentions", async () => {
        const model = new MockLanguageModelV3({
            doGenerate: async () =>
                toolCallResult("c1", "respond_to_customer", {
                    reply_text: "Qual opção de ORIGINAL você quer?",
                    pending_items: ["skol"],
                }),
        });

        const svc = new AiServiceAdapter({} as SupabaseClient, {
            model,
            catalog: catalogEmpty(),
            orderDraft: untouchableOrderDraft(),
        });

        const input: AiServiceInput = {
            context: baseContext([]),
            userText: "quero skol e original",
            intentDecision: { intent: "order_intent", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
            // Isola a propagação de pending_items do piso determinístico de multi-item
            // (coberto em outro teste) — aqui o interesse é só o auto-relato do modelo.
            isSyntheticPickText: true,
        };

        const result = await svc.run(input);
        assert.deepEqual(result.updatedPendingOrderMentions, ["skol"]);
    });

    it("piso determinístico: mensagem com 2 produtos força 2ª busca mesmo sem o modelo declarar pending_items", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                if (callCount === 1) {
                    // Modelo busca só o primeiro termo.
                    return toolCallResult("c1", "search_produtos", { query: "original" });
                }
                if (callCount === 2) {
                    // Tenta fechar perguntando só sobre "original", sem declarar pending_items
                    // (reproduz o bug real: skol some). stopWhen/prepareStep deve barrar e forçar
                    // outra busca antes de deixar fechar.
                    return toolCallResult("c2", "respond_to_customer", {
                        reply_text: "Qual opção de Original você quer?",
                    });
                }
                if (callCount === 3) {
                    // Nudge de multi-item forçou toolChoice=search_produtos de novo.
                    return toolCallResult("c3", "search_produtos", { query: "skol" });
                }
                return toolCallResult("c4", "respond_to_customer", {
                    reply_text: "Certo, qual das opções de Original e de Skol você prefere?",
                });
            },
        });

        const svc = new AiServiceAdapter({} as SupabaseClient, {
            model,
            catalog: catalogEmpty(),
            orderDraft: untouchableOrderDraft(),
        });

        const input: AiServiceInput = {
            context: baseContext([]),
            userText: "quero skol e original",
            intentDecision: { intent: "order_intent", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
            isSyntheticPickText: false,
        };

        const result = await svc.run(input);

        assert.equal(
            callCount,
            4,
            "esperava 4 chamadas (search original → tentativa de fechar → nudge força search skol → respond final)"
        );
        assert.deepEqual(model.doGenerateCalls[2]?.toolChoice, {
            type: "tool",
            toolName: "search_produtos",
        });
        assert.equal(result.action !== "error", true);
    });

    it("piso determinístico não dispara em texto sintético de pick (isSyntheticPickText=true)", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                return toolCallResult("c1", "respond_to_customer", { reply_text: "Prontinho!" });
            },
        });

        const svc = new AiServiceAdapter({} as SupabaseClient, {
            model,
            catalog: catalogEmpty(),
            orderDraft: untouchableOrderDraft(),
        });

        const input: AiServiceInput = {
            context: baseContext([]),
            userText: '[interno] Cliente escolheu a embalagem "ORIGINAL 60ML" (id allowlist x), quantity 1.',
            intentDecision: { intent: "order_intent", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
            isSyntheticPickText: true,
        };

        const result = await svc.run(input);
        assert.equal(callCount, 1);
        assert.equal(result.action, "reply");
    });
});
