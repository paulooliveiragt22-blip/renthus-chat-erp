import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiServiceAdapter } from "../../src/pro/adapters/ai/ai.service";
import type { CatalogPort } from "../../src/pro/ports/catalog.port";
import type { OrderDraftPort } from "../../src/pro/ports/orderDraft.port";
import type { AiServiceInput, OrderWorklist, PipelineContext } from "../../src/types/contracts";
import { hydrateWorklistFromLegacyMentions } from "../../src/pro/domain/orderWorklist/orderWorklist";

/**
 * Regressão do bug real de smoke: "quero skol e original" (2 produtos ambíguos na mesma
 * mensagem) resolvia só "original" — "skol" sumia silenciosamente do pedido.
 *
 * ADR 0011 Fase 3: worklist tipada é canônica; force-search lê lines `pending_search`
 * (extract selada / hydrate legado), não `outros_produtos_pendentes` nem fila string.
 */

function baseContext(opts?: {
    pendingOrderMentions?: string[];
    orderWorklist?: OrderWorklist | null;
}): PipelineContext {
    const mentions = opts?.pendingOrderMentions ?? [];
    const orderWorklist =
        opts?.orderWorklist ??
        (mentions.length
            ? hydrateWorklistFromLegacyMentions({ mentions })
            : null);
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
            pendingOrderMentions: mentions,
            orderWorklist,
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

function pendingSearchTerms(wl: OrderWorklist | null | undefined): string[] {
    return (wl?.lines ?? [])
        .filter((l) => l.status === "pending_search")
        .map((l) => l.rawTerm.toLowerCase());
}

describe("AiServiceAdapter — orderWorklist pending_search (item citado e não buscado)", () => {
    it("carryover de turno anterior força search_produtos antes de fechar", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                if (callCount === 1) {
                    return toolCallResult("c1", "respond_to_customer", {
                        reply_text: "Aqui está sua Original!",
                    });
                }
                // Worklist: 1º empty → ainda pending_search; 2º empty → not_found (MAX attempts=2).
                if (callCount === 2 || callCount === 3) {
                    return toolCallResult(`c${callCount}`, "search_produtos", {
                        query: "skol",
                    });
                }
                return toolCallResult(`c${callCount}`, "respond_to_customer", {
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
            context: baseContext({ pendingOrderMentions: ["skol"] }),
            userText: "continua com o pedido",
            intentDecision: { intent: "order_intent", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
        };

        const result = await svc.run(input);

        assert.ok(callCount >= 3, `esperava ≥3 chamadas (respond → force search…), teve ${callCount}`);
        assert.ok(
            model.doGenerateCalls.some(
                (c) =>
                    c.toolChoice &&
                    typeof c.toolChoice === "object" &&
                    "toolName" in c.toolChoice &&
                    c.toolChoice.toolName === "search_produtos"
            ),
            "esperava toolChoice forçado para search_produtos"
        );
        assert.equal(result.action !== "error", true);
        assert.deepEqual(pendingSearchTerms(result.updatedOrderWorklist), []);
    });

    it("sem pending_search, não força search extra (comportamento normal preservado)", async () => {
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
            context: baseContext(),
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

    it("mensagem skol e original: extract/worklist força search do 2º antes de fechar", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                if (callCount === 1) {
                    return toolCallResult("c1", "search_produtos", {
                        query: "original",
                    });
                }
                if (callCount === 2) {
                    return toolCallResult("c2", "respond_to_customer", {
                        reply_text: "Qual opção de Original você quer?",
                    });
                }
                /**
                 * Empty catalog: cada line precisa de MAX_SEARCH_ATTEMPTS (2) antes de not_found.
                 * original já tem 1 attempt no call 1; skol precisa de 2; original +1.
                 */
                if (callCount === 3 || callCount === 4) {
                    return toolCallResult(`c${callCount}`, "search_produtos", {
                        query: "skol",
                    });
                }
                if (callCount === 5) {
                    return toolCallResult("c5", "search_produtos", {
                        query: "original",
                    });
                }
                return toolCallResult(`c${callCount}`, "respond_to_customer", {
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
            context: baseContext(),
            userText: "quero skol e original",
            intentDecision: { intent: "order_intent", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
        };

        const result = await svc.run(input);

        assert.ok(callCount >= 4, `esperava ≥4 chamadas (search original → force skol…), teve ${callCount}`);
        assert.ok(
            model.doGenerateCalls.some(
                (c) =>
                    c.toolChoice &&
                    typeof c.toolChoice === "object" &&
                    "toolName" in c.toolChoice &&
                    c.toolChoice.toolName === "search_produtos"
            ),
            "esperava force search_produtos para o 2º item"
        );
        assert.equal(result.action !== "error", true);
        assert.deepEqual(pendingSearchTerms(result.updatedOrderWorklist), []);
        const byTerm = Object.fromEntries(
            (result.updatedOrderWorklist?.lines ?? []).map((l) => [
                l.rawTerm.toLowerCase(),
                l.status,
            ])
        );
        assert.equal(byTerm.skol, "not_found");
        assert.equal(byTerm.original, "not_found");
    });

    it("item genuinamente irresolúvel não trava o turno para sempre (maxSteps é o teto)", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
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
            context: baseContext({ pendingOrderMentions: ["produto-fantasma"] }),
            userText: "quero um produto-fantasma",
            intentDecision: { intent: "order_intent", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
        };

        const result = await svc.run(input);
        assert.ok(callCount <= 13, `esperava no máximo 13 chamadas, teve ${callCount}`);
        assert.ok(result.action === "error" || result.action === "reply" || result.action === "escalate");
    });
});
