import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { generateText, tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compareOutbound } from "../../src/pro/replay/compareOutbound";
import {
    createRecordingModel,
    createReplayModel,
    fingerprintGenerateCall,
    type LlmCassetteEntry,
} from "../../src/pro/adapters/ai/replayRecorder";
import { AiServiceAdapter } from "../../src/pro/adapters/ai/ai.service";
import type { CatalogPort } from "../../src/pro/ports/catalog.port";
import type { OrderDraftPort } from "../../src/pro/ports/orderDraft.port";
import type { AiServiceInput, PipelineContext } from "../../src/types/contracts";

describe("compareOutbound", () => {
    it("marca igualdade e mismatch", () => {
        const ok = compareOutbound(
            [{ kind: "text", text: "Oi" }],
            [{ kind: "text", text: "  oi " }]
        );
        assert.equal(ok.equal, true);

        const bad = compareOutbound(
            [{ kind: "text", text: "Oi" }],
            [{ kind: "text", text: "Tchau" }]
        );
        assert.equal(bad.equal, false);
        assert.equal(bad.mismatches.length, 1);
    });
});

describe("fingerprintGenerateCall", () => {
    it("usa o texto do último user message", () => {
        const fp = fingerprintGenerateCall({
            prompt: [
                { role: "user", content: [{ type: "text", text: "um" }] },
                { role: "assistant", content: [{ type: "text", text: "x" }] },
                { role: "user", content: [{ type: "text", text: "dois" }] },
            ],
        } as Parameters<typeof fingerprintGenerateCall>[0]);
        assert.match(fp, /dois/);
    });
});

describe("createRecordingModel / createReplayModel — round-trip", () => {
    it("grava um doGenerate() de texto e reproduz idêntico no replay", async () => {
        const inner = new MockLanguageModelV3({
            doGenerate: async () => ({
                content: [{ type: "text", text: "Oi! Como posso ajudar?" }],
                finishReason: { unified: "stop", raw: undefined },
                usage: {
                    inputTokens: { total: 20, noCache: 20, cacheRead: undefined, cacheWrite: undefined },
                    outputTokens: { total: 8, text: 8, reasoning: undefined },
                },
                warnings: [],
            }),
        });
        const { model: recordingModel, cassette } = createRecordingModel(inner);

        const recorded = await generateText({ model: recordingModel, prompt: "oi" });
        assert.equal(recorded.text, "Oi! Como posso ajudar?");
        assert.equal(cassette.length, 1);
        assert.match(cassette[0]!.requestFingerprint, /oi/);

        const replayModel = createReplayModel(cassette);
        const replayed = await generateText({ model: replayModel, prompt: "oi" });
        assert.equal(replayed.text, recorded.text);
    });

    it("cassete esgotada devolve resposta vazia segura (sem lançar)", async () => {
        const replayModel = createReplayModel([]);
        const out = await generateText({ model: replayModel, prompt: "qualquer coisa" });
        assert.equal(out.text, "");
        assert.equal(out.response.modelId, "cassette-exhausted");
    });

    it("grava e reproduz uma tool-call idêntica (não só texto)", async () => {
        const toolCallId = "call-1";
        const inner = new MockLanguageModelV3({
            doGenerate: async () => ({
                content: [
                    {
                        type: "tool-call",
                        toolCallId,
                        toolName: "echo",
                        input: JSON.stringify({ msg: "olá" }),
                    },
                ],
                finishReason: { unified: "tool-calls", raw: undefined },
                usage: {
                    inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined },
                    outputTokens: { total: 6, text: 0, reasoning: undefined },
                },
                warnings: [],
            }),
        });
        const echoTool = tool({
            description: "eco",
            inputSchema: z.object({ msg: z.string() }),
            execute: async (a) => a,
        });

        const { model: recordingModel, cassette } = createRecordingModel(inner);
        const recorded = await generateText({
            model: recordingModel,
            tools: { echo: echoTool },
            toolChoice: "required",
            prompt: "ecoa isso",
        });
        assert.equal(recorded.toolCalls[0]?.toolName, "echo");
        assert.equal(cassette.length, 1);

        const replayModel = createReplayModel(cassette);
        const replayed = await generateText({
            model: replayModel,
            tools: { echo: echoTool },
            toolChoice: "required",
            prompt: "ecoa isso",
        });
        assert.equal(replayed.toolCalls[0]?.toolName, "echo");
        assert.deepEqual(replayed.toolCalls[0]?.input, { msg: "olá" });
    });
});

function baseContext(): PipelineContext {
    return {
        tenant: { companyId: "c1", threadId: "t1", messageId: "m1", phoneE164: "+5511999999999" },
        actor: { channel: "whatsapp", source: "meta_webhook", profileName: "Cliente" },
        session: {
            step: "pro_idle",
            customerId: null,
            misunderstandingStreak: 0,
            escalationTier: 0,
            draft: null,
            aiHistory: [],
            searchProdutoEmbalagemIds: [],
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

function untouchableCatalog(): CatalogPort {
    return {
        searchDetailed: async () => {
            throw new Error("cassette-driven turn não deveria chamar o catálogo real");
        },
    };
}

function untouchableOrderDraft(): OrderDraftPort {
    return {
        prepareFromToolInput: async () => {
            throw new Error("cassette-driven turn não deveria chamar prepare_order_draft real");
        },
    };
}

function respondToCustomerCassette(replyText: string): LlmCassetteEntry[] {
    return [
        {
            requestFingerprint: "turn-1",
            result: {
                content: [
                    {
                        type: "tool-call",
                        toolCallId: "call-respond-1",
                        toolName: "respond_to_customer",
                        input: JSON.stringify({ reply_text: replyText }),
                    },
                ],
                finishReason: { unified: "tool-calls", raw: undefined },
                // Uso já cobrado durante a gravação — replay não deve re-debitar a carteira.
                usage: {
                    inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
                    outputTokens: { total: 0, text: 0, reasoning: undefined },
                },
                warnings: [],
            },
        },
    ];
}

describe("replay de um turno completo via AiServiceAdapter (ponta a ponta)", () => {
    it("reproduz respond_to_customer sem chamar rede/catálogo/prepare_order_draft", async () => {
        const cassette = respondToCustomerCassette("Oi! Bem-vindo, o que você gostaria de pedir hoje?");
        const model = createReplayModel(cassette);
        const admin = {} as SupabaseClient;

        const svc = new AiServiceAdapter(admin, {
            model,
            catalog: untouchableCatalog(),
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
        assert.equal(result.action, "reply");
        assert.match(result.replyText, /pedir/);
        assert.equal(result.signals.intentMarker, "ok");
    });

    it("cassete esgotada (turno sem respond_to_customer gravado) devolve erro TOOL_FAILED, não lança", async () => {
        const model = createReplayModel([]);
        const admin = {} as SupabaseClient;
        const svc = new AiServiceAdapter(admin, {
            model,
            catalog: untouchableCatalog(),
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
        assert.equal(result.action, "error");
        assert.equal(result.errorCode, "TOOL_FAILED");
    });
});
