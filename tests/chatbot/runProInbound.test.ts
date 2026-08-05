/**
 * runProInbound: falha do V2 → botReply fixo (sem Starter).
 */

import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { join } from "path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let runProInbound: (p: any) => Promise<void>;
let botReplyCalls = 0;
let lastBotText = "";

function setCachedModule(
    cache: Record<string, unknown>,
    basePathWithoutExt: string,
    exports: Record<string, unknown>
) {
    for (const ext of [".js", ".ts"]) {
        const p = basePathWithoutExt + ext;
        cache[p] = { id: p, filename: p, loaded: true, exports };
    }
}

before(async () => {
    const root = join(__dirname, "..", "..");
    const runProBase = join(root, "src", "pro", "pipeline", "runProPipeline");
    const depsBase = join(root, "src", "pro", "pipeline", "deps.factory");
    const menuBase = join(root, "lib", "public-menu", "resolveActiveMenuLink");
    const botBase = join(root, "lib", "chatbot", "botSend");
    const targetBase = join(root, "lib", "chatbot", "runProInbound");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = (require as any).cache as Record<string, unknown>;

    for (const base of [targetBase, runProBase, depsBase, menuBase, botBase]) {
        delete cache[base + ".js"];
        delete cache[base + ".ts"];
    }

    setCachedModule(cache, menuBase, {
        resolveActivePublicMenuLink: async () => null,
    });
    setCachedModule(cache, depsBase, {
        makeProPipelineDependencies: () => ({ _stub: "deps" }),
    });
    setCachedModule(cache, runProBase, {
        runProPipeline: async () => {
            throw new Error("pro_pipeline_simulated_failure");
        },
    });
    setCachedModule(cache, botBase, {
        botReply: async (
            _a: unknown,
            _c: unknown,
            _t: unknown,
            _p: unknown,
            text: string
        ) => {
            botReplyCalls += 1;
            lastBotText = text;
        },
    });

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    runProInbound = require(targetBase + ".ts").runProInbound;
});

describe("runProInbound", () => {
    it("falha do V2 → mensagem fixa via botReply", async () => {
        botReplyCalls = 0;
        lastBotText = "";

        const chain: Record<string, unknown> = {};
        const self = () => chain;
        chain.select = self;
        chain.eq = self;
        chain.limit = self;
        chain.maybeSingle = async () => ({ data: { config: {} }, error: null });

        await runProInbound({
            admin: { from: () => chain },
            companyId: "c1",
            threadId: "t1",
            messageId: "m1",
            phoneE164: "+5511999999999",
            text: "oi",
        });

        assert.equal(botReplyCalls, 1);
        assert.match(lastBotText, /problema técnico/i);
    });
});
