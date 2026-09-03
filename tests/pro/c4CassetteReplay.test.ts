/**
 * C4.2 — pirâmide nível C: ≥3 cassetes versionadas no CI (sem rede / catálogo / prepare).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
    createReplayModel,
    type LlmCassetteEntry,
} from "../../src/pro/adapters/ai/replayRecorder";
import { AiServiceAdapter } from "../../src/pro/adapters/ai/ai.service";
import type { CatalogPort } from "../../src/pro/ports/catalog.port";
import type { OrderDraftPort } from "../../src/pro/ports/orderDraft.port";
import type { AiServiceInput, Intent, PipelineContext } from "../../src/types/contracts";

type CassetteFixture = {
    v: number;
    cassettes: Array<{
        id: string;
        userText: string;
        intent: Intent;
        expectedAction: string;
        expectedReplySubstring: string;
        entries: LlmCassetteEntry[];
    }>;
};

function loadCassettes(): CassetteFixture {
    const path = resolve(process.cwd(), "tests/fixtures/replay/cassettes.v1.json");
    return JSON.parse(readFileSync(path, "utf8")) as CassetteFixture;
}

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
            escalationRule: {
                unknownConsecutive: 2,
                lowConfidenceConsecutive: 2,
                noProgressTurns: 3,
            },
        },
        nowIso: new Date().toISOString(),
    };
}

function untouchableCatalog(): CatalogPort {
    return {
        searchDetailed: async () => {
            throw new Error("C4 cassette não deve chamar catálogo");
        },
    };
}

function untouchableOrderDraft(): OrderDraftPort {
    return {
        prepareFromToolInput: async () => {
            throw new Error("C4 cassette não deve chamar prepare_order_draft");
        },
    };
}

describe("C4.2 cassette replay (nível C)", () => {
    it("fixture v1 tem ≥3 cassetes com respond_to_customer", () => {
        const fixture = loadCassettes();
        assert.equal(fixture.v, 1);
        assert.ok(fixture.cassettes.length >= 3, `esperado ≥3, veio ${fixture.cassettes.length}`);
        for (const c of fixture.cassettes) {
            assert.ok(c.id.length > 0);
            assert.ok(c.entries.length >= 1);
            const toolName = (c.entries[0]!.result.content as Array<{ toolName?: string }>).find(
                (p) => p.toolName
            )?.toolName;
            assert.equal(toolName, "respond_to_customer");
        }
    });

    it("reproduz cada cassete sem rede/catálogo/prepare", async () => {
        const fixture = loadCassettes();
        const admin = {} as SupabaseClient;

        for (const c of fixture.cassettes) {
            const model = createReplayModel(c.entries);
            const svc = new AiServiceAdapter(admin, {
                model,
                catalog: untouchableCatalog(),
                orderDraft: untouchableOrderDraft(),
            });

            const input: AiServiceInput = {
                context: baseContext(),
                userText: c.userText,
                intentDecision: {
                    intent: c.intent,
                    confidence: "high",
                    reasonCode: "regex_match",
                },
                draft: null,
                history: [],
                limits: { maxToolRounds: 8, maxHistoryTurns: 12, timeoutMs: 5_000 },
            };

            const result = await svc.run(input);
            assert.equal(result.action, c.expectedAction, c.id);
            assert.match(
                result.replyText ?? "",
                new RegExp(c.expectedReplySubstring, "i"),
                c.id
            );
        }
    });
});
