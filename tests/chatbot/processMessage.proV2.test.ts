/**
 * Fronteira: `processInboundMessage` sempre delega a `runProInbound` (motor único).
 */

import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { join } from "path";
import Module from "node:module";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processInboundMessage: (p: any) => Promise<void>;
let proRuns = 0;
let proShouldThrow = false;

before(() => {
    const root = join(__dirname, "..", "..");
    const distProInbound = join(root, "lib", "chatbot", "runProInbound.js");
    const distProcess = join(root, "lib", "chatbot", "processMessage.js");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = (require as any).cache as Record<string, NodeModule>;

    delete cache[distProcess];
    delete cache[distProInbound];

    const mockExports = {
        runProInbound: async () => {
            proRuns += 1;
            if (proShouldThrow) throw new Error("pro_pipeline_simulated_failure");
        },
    };

    cache[distProInbound] = {
        id: distProInbound,
        filename: distProInbound,
        loaded: true,
        exports: mockExports,
        children: [],
        paths: [],
        parent: null,
        path: join(root, "lib", "chatbot"),
        require: Module.createRequire(distProInbound),
    } as unknown as NodeModule;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    processInboundMessage = require(distProcess).processInboundMessage;
});

afterEach(() => {
    proRuns = 0;
    proShouldThrow = false;
});

describe("processInboundMessage — motor PRO único", () => {
    it("sempre chama runProInbound", async () => {
        await processInboundMessage({
            admin: {},
            companyId: "c1",
            threadId: "t1",
            messageId: "m1",
            phoneE164: "+5511999999999",
            text: "oi",
        });

        assert.equal(proRuns, 1);
    });

    it("propaga falha do runProInbound (sem fallback Starter)", async () => {
        proShouldThrow = true;
        await assert.rejects(
            () =>
                processInboundMessage({
                    admin: {},
                    companyId: "c1",
                    threadId: "t1",
                    messageId: "m1",
                    phoneE164: "+5511999999999",
                    text: "oi",
                }),
            /pro_pipeline_simulated_failure/
        );
        assert.equal(proRuns, 1);
    });
});
