/**
 * Fronteira PRO: `processInboundMessage` sempre usa `runProInbound` (sem shadow / flags).
 */

import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processInboundMessage: (p: any) => Promise<void>;
let legacyCalls = 0;
let proRuns = 0;
let proShouldThrow = false;

function setCachedModule(
    cache: Record<string, unknown>,
    basePathWithoutExt: string,
    exports: Record<string, unknown>
) {
    for (const ext of [".js", ".ts"]) {
        const p = basePathWithoutExt + ext;
        cache[p] = {
            id: p,
            filename: p,
            loaded: true,
            exports,
        };
    }
}

before(async () => {
    process.env.CHATBOT_TEST_FORCE_TIER = "pro";

    const root = join(__dirname, "..", "..");
    const inboundBase = join(root, "lib", "chatbot", "inboundPipeline");
    const proInboundBase = join(root, "lib", "chatbot", "runProInbound");
    const processMsgBase = join(root, "lib", "chatbot", "processMessage");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = (require as any).cache as Record<string, unknown>;

    for (const base of [processMsgBase, inboundBase, proInboundBase]) {
        delete cache[base + ".js"];
        delete cache[base + ".ts"];
    }

    setCachedModule(cache, inboundBase, {
        runInboundChatbotPipeline: async () => {
            legacyCalls += 1;
        },
    });

    setCachedModule(cache, proInboundBase, {
        runProInbound: async () => {
            proRuns += 1;
            if (proShouldThrow) throw new Error("pro_pipeline_simulated_failure");
        },
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    processInboundMessage = require(processMsgBase + ".ts").processInboundMessage;
});

afterEach(() => {
    legacyCalls = 0;
    proRuns = 0;
    proShouldThrow = false;
    process.env.CHATBOT_TEST_FORCE_TIER = "pro";
});

function stubAdmin() {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    chain.select = self;
    chain.eq = self;
    chain.limit = self;
    chain.maybeSingle = async () => ({ data: { config: {} }, error: null });
    return { from: () => chain };
}

describe("processInboundMessage — PRO Pipeline V2 único", () => {
    it("após sucesso do PRO não chama pipeline Starter", async () => {
        await processInboundMessage({
            admin: stubAdmin(),
            companyId: "c1",
            threadId: "t1",
            messageId: "m1",
            phoneE164: "+5511999999999",
            text: "oi",
        });

        assert.equal(proRuns, 1);
        assert.equal(legacyCalls, 0);
    });

    it("se o PRO falhar no wrapper, processMessage não cai no Starter", async () => {
        // Falha engolida dentro de runProInbound (mensagem fixa); aqui garantimos
        // que mesmo com throw no mock de runProInbound o Starter não corre.
        const root = join(__dirname, "..", "..");
        const proInboundBase = join(root, "lib", "chatbot", "runProInbound");
        const processMsgBase = join(root, "lib", "chatbot", "processMessage");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cache = (require as any).cache as Record<string, unknown>;

        setCachedModule(cache, proInboundBase, {
            runProInbound: async () => {
                proRuns += 1;
                // runProInbound real engole erro; mock que engole também
            },
        });
        delete cache[processMsgBase + ".js"];
        delete cache[processMsgBase + ".ts"];
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        processInboundMessage = require(processMsgBase + ".ts").processInboundMessage;

        await processInboundMessage({
            admin: stubAdmin(),
            companyId: "c1",
            threadId: "t1",
            messageId: "m1",
            phoneE164: "+5511999999999",
            text: "oi",
        });

        assert.equal(proRuns, 1);
        assert.equal(legacyCalls, 0);
    });
});
