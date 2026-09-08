import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS,
    ANTHROPIC_PROMPT_CACHE_CONTROL,
    ESTIMATED_AGENT_TOOLS_TOKENS_LOW,
    anthropicCacheProviderOptions,
    ensureStableSystemMeetsCacheFloor,
    estimateAnthropicTokensLow,
    isLlmPromptCacheEnabled,
} from "../../src/pro/adapters/ai/promptCache";
import { buildPromptPartsForCache } from "../../src/pro/adapters/ai/promptParts";
import type { AiServiceInput, PipelineContext } from "../../src/types/contracts";
import { hydrateWorklistFromLegacyMentions } from "../../src/pro/domain/orderWorklist/orderWorklist";

describe("isLlmPromptCacheEnabled", () => {
    it("Anthropic: default on", () => {
        assert.equal(isLlmPromptCacheEnabled("anthropic", {}), true);
    });

    it("Groq/OpenAI: always off (mesmo com flag 1)", () => {
        assert.equal(isLlmPromptCacheEnabled("groq", { LLM_CACHE_CONTROL_ENABLED: "1" }), false);
        assert.equal(isLlmPromptCacheEnabled("openai", { LLM_CACHE_CONTROL_ENABLED: "1" }), false);
    });

    it("Anthropic: flag 0/false/off desliga", () => {
        assert.equal(isLlmPromptCacheEnabled("anthropic", { LLM_CACHE_CONTROL_ENABLED: "0" }), false);
        assert.equal(isLlmPromptCacheEnabled("anthropic", { LLM_CACHE_CONTROL_ENABLED: "false" }), false);
        assert.equal(isLlmPromptCacheEnabled("anthropic", { LLM_CACHE_CONTROL_ENABLED: "off" }), false);
    });

    it("Anthropic: flag 1/true liga", () => {
        assert.equal(isLlmPromptCacheEnabled("anthropic", { LLM_CACHE_CONTROL_ENABLED: "1" }), true);
        assert.equal(isLlmPromptCacheEnabled("anthropic", { LLM_CACHE_CONTROL_ENABLED: "true" }), true);
    });
});

describe("anthropicCacheProviderOptions", () => {
    it("ephemeral 5m (ADR-0003 §9.3)", () => {
        assert.deepEqual(anthropicCacheProviderOptions(), {
            anthropic: { cacheControl: ANTHROPIC_PROMPT_CACHE_CONTROL },
        });
        assert.equal(ANTHROPIC_PROMPT_CACHE_CONTROL.type, "ephemeral");
        assert.equal(ANTHROPIC_PROMPT_CACHE_CONTROL.ttl, "5m");
    });
});

describe("ensureStableSystemMeetsCacheFloor", () => {
    it("pad até tools+system ≥ mínimo Haiku 4.5", () => {
        const short = "regras curtas";
        const padded = ensureStableSystemMeetsCacheFloor(short);
        assert.ok(
            estimateAnthropicTokensLow(padded) + ESTIMATED_AGENT_TOOLS_TOKENS_LOW >=
                ANTHROPIC_HAIKU_45_MIN_CACHE_TOKENS
        );
        assert.ok(padded.includes("Exemplos estáveis"));
        // idempotente / estável: mesma entrada → mesmo pad
        assert.equal(ensureStableSystemMeetsCacheFloor(short), padded);
    });
});

describe("buildPromptPartsForCache — estável vs dinâmico", () => {
    function baseInput(opts?: { withDraft?: boolean; withWorklist?: boolean }): AiServiceInput {
        const draft = opts?.withDraft
            ? {
                  items: [
                      {
                          produtoEmbalagemId: "e1",
                          productName: "Skol 350ml",
                          quantity: 2,
                          unitPrice: 4.5,
                          fatorConversao: 1,
                          productVolumeId: null,
                          estoqueUnidades: 10,
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
                  totalItems: 2,
                  grandTotal: 9,
                  pendingConfirmation: false,
                  version: 1,
              }
            : null;
        const orderWorklist = opts?.withWorklist
            ? hydrateWorklistFromLegacyMentions({ mentions: ["original"] })
            : null;
        const context: PipelineContext = {
            tenant: {
                companyId: "c1",
                threadId: "t1",
                messageId: "m1",
                phoneE164: "+5511999999999",
            },
            actor: { channel: "whatsapp", source: "meta_webhook", profileName: "Cliente" },
            session: {
                step: "pro_collecting_order",
                customerId: null,
                misunderstandingStreak: 0,
                escalationTier: 0,
                draft,
                aiHistory: [],
                searchProdutoEmbalagemIds: [],
                pendingOrderMentions: [],
                orderWorklist,
                aiHistorySummary: "Cliente pediu cerveja no turno anterior.",
            },
            policies: {
                locale: "pt-BR",
                maxToolRounds: 8,
                maxHistoryTurns: 12,
                aiTimeoutMs: 5_000,
                llmEnabled: true,
                escalationRule: {
                    unknownConsecutive: 2,
                    lowConfidenceConsecutive: 2,
                    noProgressTurns: 3,
                },
            },
            nowIso: new Date().toISOString(),
            prefetchedOrderHints: { favorite_lines: [{ name: "Skol" }] },
        };
        return {
            userText: "quero mais uma skol",
            history: [],
            context,
            draft,
            intentDecision: { intent: "order_intent", confidence: "high", reasonCode: "active_order_session" },
            limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
        };
    }

    it("stable NÃO inclui draft/worklist/summary/hints; dynamic SIM", () => {
        const { stableSystem, dynamicContext } = buildPromptPartsForCache(
            baseInput({ withDraft: true, withWorklist: true })
        );
        assert.ok(stableSystem.length > 200, "system estável deve ter regras");
        assert.ok(!stableSystem.includes("Skol 350ml"), "draft não no estável");
        assert.ok(
            !stableSystem.includes("Itens ainda não resolvidos"),
            "bloco worklist não no estável"
        );
        assert.ok(!stableSystem.includes("turno anterior"), "summary não no estável");
        assert.ok(!stableSystem.includes("favorite_lines"), "hints não no estável");

        assert.ok(dynamicContext.includes("Skol 350ml"), "draft no dinâmico");
        assert.ok(
            dynamicContext.includes("Itens ainda não resolvidos"),
            "worklist no dinâmico"
        );
        assert.ok(/original/i.test(dynamicContext), "termo pending_search no dinâmico");
        assert.ok(dynamicContext.includes("turno anterior"), "summary no dinâmico");
        assert.ok(dynamicContext.includes("favorite_lines"), "hints no dinâmico");
    });

    it("dois turnos com draft diferente: estável idêntico (cache hit no prefixo)", () => {
        const a = buildPromptPartsForCache(baseInput({ withDraft: false }));
        const b = buildPromptPartsForCache(baseInput({ withDraft: true }));
        assert.equal(a.stableSystem, b.stableSystem);
        assert.notEqual(a.dynamicContext, b.dynamicContext);
        assert.equal(
            ensureStableSystemMeetsCacheFloor(a.stableSystem),
            ensureStableSystemMeetsCacheFloor(b.stableSystem)
        );
    });
});
