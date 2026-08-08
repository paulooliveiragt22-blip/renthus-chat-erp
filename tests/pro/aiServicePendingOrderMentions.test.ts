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
 * mensagem) resolvia só "original" — "skol" sumia silenciosamente do pedido.
 *
 * Fix final (2ª iteração — a 1ª, baseada em `respond_to_customer.pending_items` opcional +
 * heurística lexical de texto, não sobreviveu a reteste real): `search_produtos` exige, via
 * schema Zod OBRIGATÓRIO, o campo `outros_produtos_pendentes` a cada chamada. O modelo não pode
 * simplesmente "esquecer" de declarar — o SDK valida o input contra o schema. Ver
 * `shouldForceSearchForDeclaredPendingTerms` em ai.service.ts e docs/PLANO_MIGRACAO_VERCEL_AI_SDK.md.
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
    it("carryover de turno anterior força search_produtos antes de fechar", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                if (callCount === 1) {
                    // Modelo tenta fechar direto, ignorando o "skol" pendente da sessão.
                    return toolCallResult("c1", "respond_to_customer", {
                        reply_text: "Aqui está sua Original!",
                    });
                }
                if (callCount === 2) {
                    // Nudge forçou search_produtos — modelo busca o termo pendente e declara
                    // que não sobrou mais nada (schema obrigatório).
                    return toolCallResult("c2", "search_produtos", {
                        query: "skol",
                        outros_produtos_pendentes: [],
                    });
                }
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
        assert.deepEqual(result.updatedPendingOrderMentions, []);
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

    it("mensagem com 2 produtos: search_produtos declara o 2º pendente (schema obrigatório) e é forçado antes de fechar", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                if (callCount === 1) {
                    // Modelo busca "original" e é OBRIGADO pelo schema a declarar o que sobrou.
                    return toolCallResult("c1", "search_produtos", {
                        query: "original",
                        outros_produtos_pendentes: ["skol"],
                    });
                }
                if (callCount === 2) {
                    // Tenta fechar perguntando só sobre Original — reproduz o bug real. Deve ser
                    // barrado pelo stopWhen/prepareStep, já que turnState.pendingTermsFromSearch
                    // ainda tem "skol".
                    return toolCallResult("c2", "respond_to_customer", {
                        reply_text: "Qual opção de Original você quer?",
                    });
                }
                if (callCount === 3) {
                    // Nudge forçou busca do termo pendente; agora declara lista vazia.
                    return toolCallResult("c3", "search_produtos", {
                        query: "skol",
                        outros_produtos_pendentes: [],
                    });
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
        assert.deepEqual(result.updatedPendingOrderMentions, []);
    });

    it("item genuinamente irresolúvel não trava o turno para sempre (maxSteps é o teto)", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                // Modelo sempre tenta fechar sem nunca zerar o pendente (ex.: item fora de
                // catálogo que o modelo insiste em não resolver) — nunca chama search_produtos.
                return toolCallResult(`c${callCount}`, "respond_to_customer", {
                    reply_text: "Não encontrei esse item, mas segue o resto do pedido.",
                });
            },
        });

        const svc = new AiServiceAdapter({} as SupabaseClient, {
            model,
            catalog: catalogEmpty(),
            orderDraft: untouchableOrderDraft(),
        });

        const input: AiServiceInput = {
            context: baseContext(["produto-fantasma"]),
            userText: "quero um produto-fantasma",
            intentDecision: { intent: "order_intent", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
        };

        const result = await svc.run(input);
        // maxSteps = maxToolRounds(8) + 4 = 12: o loop termina por stepCountIs, não trava.
        assert.ok(callCount <= 12, `esperava no máximo 12 chamadas, teve ${callCount}`);
        assert.ok(result.action === "error" || result.action === "reply" || result.action === "escalate");
    });
});
