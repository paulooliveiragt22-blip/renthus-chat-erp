/**
 * Fronteira PRO Pipeline V2 em `processInboundMessage` (modo active vs shadow vs fallback).
 *
 * Injeta módulos via require.cache (mesmo padrão que `processMessageFlows.test.ts`)
 * para não depender de Supabase nem do motor legado completo.
 */

import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processInboundMessage: (p: any) => Promise<void>;
let legacyCalls = 0;
let proRuns = 0;

const emptyProState = {
    step: "pro_idle" as const,
    customerId: null,
    misunderstandingStreak: 0,
    escalationTier: 0 as const,
    draft: null,
    aiHistory: [],
    searchProdutoEmbalagemIds: [],
};

before(async () => {
    const root = join(__dirname, "..", "..");
    const tierPath = join(root, "lib", "chatbot", "tier.js");
    const inboundPath = join(root, "lib", "chatbot", "inboundPipeline.js");
    const depsFactoryPath = join(root, "src", "pro", "pipeline", "deps.factory.js");
    const runProPath = join(root, "src", "pro", "pipeline", "runProPipeline.js");
    const processMsgPath = join(root, "lib", "chatbot", "processMessage.js");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = (require as any).cache as Record<string, unknown>;

    for (const p of [processMsgPath, inboundPath, tierPath, depsFactoryPath, runProPath]) {
        delete cache[p];
    }

    cache[tierPath] = {
        id: tierPath,
        filename: tierPath,
        loaded: true,
        exports: {
            getChatbotProductTier: async () => "pro",
        },
    };

    cache[inboundPath] = {
        id: inboundPath,
        filename: inboundPath,
        loaded: true,
        exports: {
            runInboundChatbotPipeline: async () => {
                legacyCalls += 1;
            },
        },
    };

    cache[depsFactoryPath] = {
        id: depsFactoryPath,
        filename: depsFactoryPath,
        loaded: true,
        exports: {
            makeProPipelineDependencies: () => ({ _stub: "deps" }),
        },
    };

    cache[runProPath] = {
        id: runProPath,
        filename: runProPath,
        loaded: true,
        exports: {
            runProPipeline: async () => {
                proRuns += 1;
                return {
                    nextState: emptyProState,
                    outbound: [],
                    sideEffects: [],
                    metrics: [],
                };
            },
        },
    };

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    processInboundMessage = require(processMsgPath).processInboundMessage;
});

afterEach(() => {
    legacyCalls = 0;
    proRuns = 0;
    delete process.env.CHATBOT_PRO_PIPELINE_V2;
    delete process.env.CHATBOT_PRO_PIPELINE_V2_MODE;
});

describe("processInboundMessage — PRO Pipeline V2 fronteira", () => {
    it("modo active: após sucesso do V2 não chama pipeline legado", async () => {
        process.env.CHATBOT_PRO_PIPELINE_V2 = "1";
        process.env.CHATBOT_PRO_PIPELINE_V2_MODE = "active";

        await processInboundMessage({
            admin: {},
            companyId: "c1",
            threadId: "t1",
            messageId: "m1",
            phoneE164: "+5511999999999",
            text: "oi",
        });

        assert.equal(proRuns, 1);
        assert.equal(legacyCalls, 0);
    });

    it("modo active: se o V2 falhar, não chama legado e envia mensagem fixa (botReply)", async () => {
        process.env.CHATBOT_PRO_PIPELINE_V2 = "1";
        process.env.CHATBOT_PRO_PIPELINE_V2_MODE = "active";

        const root = join(__dirname, "..", "..");
        const runProPath = join(root, "src", "pro", "pipeline", "runProPipeline.js");
        const processMsgPath = join(root, "lib", "chatbot", "processMessage.js");
        const botSendPath = join(root, "lib", "chatbot", "botSend.js");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cache = (require as any).cache as Record<string, unknown>;
        const prevRunPro = cache[runProPath];
        const prevBotSend = cache[botSendPath];
        let botReplyCalls = 0;

        cache[botSendPath] = {
            id: botSendPath,
            filename: botSendPath,
            loaded: true,
            exports: {
                botReply: async () => {
                    botReplyCalls += 1;
                },
            },
        };

        cache[runProPath] = {
            id: runProPath,
            filename: runProPath,
            loaded: true,
            exports: {
                runProPipeline: async () => {
                    proRuns += 1;
                    throw new Error("pro_pipeline_simulated_failure");
                },
            },
        };
        delete cache[processMsgPath];
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            processInboundMessage = require(processMsgPath).processInboundMessage;

            await processInboundMessage({
                admin: {},
                companyId: "c1",
                threadId: "t1",
                messageId: "m1",
                phoneE164: "+5511999999999",
                text: "oi",
            });

            assert.equal(proRuns, 1);
            assert.equal(legacyCalls, 0);
            assert.equal(botReplyCalls, 1);
        } finally {
            cache[runProPath] = prevRunPro;
            if (prevBotSend === undefined) delete cache[botSendPath];
            else cache[botSendPath] = prevBotSend;
            delete cache[processMsgPath];
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            processInboundMessage = require(processMsgPath).processInboundMessage;
        }
    });

    it("modo shadow: após sucesso do V2 ainda executa pipeline legado", async () => {
        process.env.CHATBOT_PRO_PIPELINE_V2 = "1";
        process.env.CHATBOT_PRO_PIPELINE_V2_MODE = "shadow";

        await processInboundMessage({
            admin: {},
            companyId: "c1",
            threadId: "t1",
            messageId: "m1",
            phoneE164: "+5511999999999",
            text: "oi",
        });

        assert.equal(proRuns, 1);
        assert.equal(legacyCalls, 1);
    });
});
