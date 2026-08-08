import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MockLanguageModelV3 } from "ai/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AiServiceAdapter } from "../../src/pro/adapters/ai/ai.service";
import type { CatalogPort } from "../../src/pro/ports/catalog.port";
import type { OrderDraftPort } from "../../src/pro/ports/orderDraft.port";
import type { ChatProdutoRow } from "../../src/pro/tools/searchProdutos";
import type { AiServiceInput, PendingPickGroup, PipelineContext } from "../../src/types/contracts";

/**
 * Regressão do bug real de smoke S2 ("quero whisky e marmita"): o `search_produtos` achava
 * MARMITA G/M/P (ambíguo, nomes distintos) e criava `pendingPickGroups` NESTE MESMO turno —
 * mas o `prepareStep` forçava `resolve_pending_picks` na sequência, ANTES de o cliente ver a
 * pergunta. O modelo "chutava" uma embalagem (ex.: sempre M) sem o cliente ter dito nada, e o
 * `lastSearchPicks` obsoleto ainda disparava o card de botão legado por cima da resposta da IA.
 *
 * Fix: só força `resolve_pending_picks` para grupos que já existiam no `session.pendingPickGroups`
 * no INÍCIO do turno (carryover — cliente já viu a pergunta num turno anterior). Grupo criado
 * agora mesmo por `search_produtos` fica pendente para o pipeline resolver em texto livre depois
 * (`resolveCheckoutTurnOutcome` → `clarify_pending_picks`), sem forçar chute da IA no mesmo turno.
 */

function baseContext(pendingPickGroups: PendingPickGroup[] = []): PipelineContext {
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
            pendingPickGroups,
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

function makeRow(over: Partial<ChatProdutoRow>): ChatProdutoRow {
    return {
        id: "id-1",
        product_name: "Marmita G",
        display_name: null,
        descricao: null,
        sigla_comercial: "UN",
        preco_venda: 45,
        volume_quantidade: null,
        unit_type_sigla: null,
        fator_conversao: 1,
        product_volume_id: null,
        category_id: null,
        ...over,
    };
}

function catalogAmbiguousMarmita(): CatalogPort {
    return {
        async searchDetailed() {
            return {
                items: [
                    makeRow({ id: "marmita-g", product_name: "Marmita G", display_name: "MARMITA G", preco_venda: 45 }),
                    makeRow({ id: "marmita-m", product_name: "Marmita M", display_name: "MARMITA M", preco_venda: 35 }),
                    makeRow({ id: "marmita-p", product_name: "Marmita P", display_name: "MARMITA P", preco_venda: 30 }),
                ],
                didYouMean: [],
                empty: false,
                queryNormalized: "marmita",
            };
        },
    };
}

function fakeAdmin(): SupabaseClient {
    return {} as unknown as SupabaseClient;
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

describe("AiServiceAdapter — não força resolve_pending_picks no mesmo turno da descoberta", () => {
    it("search_produtos acha ambiguidade nova: respond_to_customer fecha o turno sem forçar resolve_pending_picks", async () => {
        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                if (callCount === 1) {
                    return toolCallResult("c1", "search_produtos", {
                        query: "marmita",
                        outros_produtos_pendentes: [],
                    });
                }
                // Modelo pergunta em texto livre e encerra — não deve ser forçado a
                // "adivinhar" a embalagem via resolve_pending_picks nesta mesma mensagem.
                return toolCallResult("c2", "respond_to_customer", {
                    reply_text: "Qual marmita você quer: G, M ou P?",
                });
            },
        });

        const svc = new AiServiceAdapter(fakeAdmin(), {
            model,
            catalog: catalogAmbiguousMarmita(),
            orderDraft: untouchableOrderDraft(),
        });

        const input: AiServiceInput = {
            context: baseContext([]),
            userText: "quero marmita",
            intentDecision: { intent: "order_intent", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
        };

        const result = await svc.run(input);

        assert.equal(callCount, 2, "não deve haver uma 3ª chamada forçando resolve_pending_picks");
        assert.ok(
            !model.doGenerateCalls.some(
                (c) =>
                    typeof c.toolChoice === "object" &&
                    c.toolChoice !== null &&
                    "toolName" in c.toolChoice &&
                    c.toolChoice.toolName === "resolve_pending_picks"
            ),
            "resolve_pending_picks nunca deveria ser forçado no turno em que o grupo foi criado"
        );
        assert.equal(result.action !== "error", true);
        assert.equal((result.updatedPendingPickGroups ?? []).length, 1, "grupo deve ficar pendente para o próximo turno");
    });

    it("pendingPickGroups de carryover (turno anterior): força resolve_pending_picks na resposta atual", async () => {
        const carryoverGroup: PendingPickGroup = {
            productKey: "marmita",
            productLabel: "marmita",
            options: [
                { embalagemId: "marmita-g", displayName: "MARMITA G", productName: "Marmita G", siglaComercial: "UN", precoVenda: 45, fatorConversao: 1 },
                { embalagemId: "marmita-m", displayName: "MARMITA M", productName: "Marmita M", siglaComercial: "UN", precoVenda: 35, fatorConversao: 1 },
                { embalagemId: "marmita-p", displayName: "MARMITA P", productName: "Marmita P", siglaComercial: "UN", precoVenda: 30, fatorConversao: 1 },
            ],
            unresolvedTurns: 1,
        };

        let callCount = 0;
        const model = new MockLanguageModelV3({
            doGenerate: async () => {
                callCount += 1;
                if (callCount === 1) {
                    // Tenta fechar direto sem resolver o grupo pendente do turno anterior.
                    return toolCallResult("c1", "respond_to_customer", {
                        reply_text: "Perfeito, já anotei!",
                    });
                }
                if (callCount === 2) {
                    // Nudge força resolve_pending_picks; cliente disse "a M" nesta mensagem.
                    return toolCallResult("c2", "resolve_pending_picks", {
                        picks: [{ product_key: "marmita", produto_embalagem_id: "marmita-m", quantity: 1 }],
                    });
                }
                return toolCallResult("c3", "respond_to_customer", {
                    reply_text: "Marmita M anotada!",
                });
            },
        });

        const svc = new AiServiceAdapter(fakeAdmin(), {
            model,
            catalog: catalogAmbiguousMarmita(),
            orderDraft: {
                prepareFromToolInput: async () => ({
                    ok: true,
                    errors: [],
                    blocked: null,
                    draft: {
                        items: [
                            {
                                produtoEmbalagemId: "marmita-m",
                                productName: "Marmita M",
                                quantity: 1,
                                unitPrice: 35,
                                fatorConversao: 1,
                                estoqueUnidades: 100,
                                productVolumeId: null,
                            },
                        ],
                        address: null,
                        paymentMethod: null,
                        changeFor: null,
                        deliveryFee: 0,
                        deliveryZoneId: null,
                        deliveryAddressText: null,
                        deliveryMinOrder: null,
                        deliveryEtaMin: null,
                        totalItems: 1,
                        grandTotal: 35,
                        pendingConfirmation: false,
                        version: 1,
                    },
                }),
            },
        });

        const input: AiServiceInput = {
            context: baseContext([carryoverGroup]),
            userText: "quero a m",
            intentDecision: { intent: "order_intent", confidence: "high", reasonCode: "regex_match" },
            draft: null,
            history: [],
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
        };

        const result = await svc.run(input);

        assert.equal(
            callCount,
            3,
            "esperava tentativa de fechar + nudge forçando resolve_pending_picks + respond final"
        );
        assert.deepEqual(model.doGenerateCalls[1]?.toolChoice, {
            type: "tool",
            toolName: "resolve_pending_picks",
        });
        assert.equal(result.action !== "error", true);
        assert.equal((result.updatedPendingPickGroups ?? []).length, 0, "grupo resolvido deve sair de pendingPickGroups");
    });
});
