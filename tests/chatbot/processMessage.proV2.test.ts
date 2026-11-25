/**
 * Fronteira: delivery entra em `runProInbound`. Serviço entra em `runServiceTurn`.
 */

import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import { join } from "path";
import Module from "node:module";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let processInboundMessage: (p: any) => Promise<void>;
let proRuns = 0;
let serviceRuns = 0;
let proShouldThrow = false;

function adminWithMode(mode: "delivery" | "service" | "broken" | "missing") {
    return {
        from(table: string) {
            if (table !== "companies") {
                throw new Error(`unexpected table ${table}`);
            }
            return {
                select() {
                    return {
                        eq() {
                            return {
                                maybeSingle: async () => {
                                    if (mode === "broken") {
                                        return { data: null, error: { message: "db down" } };
                                    }
                                    if (mode === "missing") {
                                        return { data: null, error: null };
                                    }
                                    return { data: { attendance_mode: mode }, error: null };
                                },
                            };
                        },
                    };
                },
            };
        },
    };
}

const baseParams = {
    companyId: "c1",
    threadId: "t1",
    messageId: "m1",
    phoneE164: "+5511999999999",
    text: "oi",
};

before(() => {
    const root = join(__dirname, "..", "..");
    const distProInbound = join(root, "lib", "chatbot", "runProInbound.js");
    const distServiceTurn = join(root, "src", "service", "application", "runServiceTurn.js");
    const distProcess = join(root, "lib", "chatbot", "processMessage.js");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = (require as any).cache as Record<string, NodeModule>;

    delete cache[distProcess];
    delete cache[distProInbound];
    delete cache[distServiceTurn];

    cache[distProInbound] = {
        id: distProInbound,
        filename: distProInbound,
        loaded: true,
        exports: {
            runProInbound: async () => {
                proRuns += 1;
                if (proShouldThrow) throw new Error("pro_pipeline_simulated_failure");
            },
        },
        children: [],
        paths: [],
        parent: null,
        path: join(root, "lib", "chatbot"),
        require: Module.createRequire(distProInbound),
    } as unknown as NodeModule;

    cache[distServiceTurn] = {
        id: distServiceTurn,
        filename: distServiceTurn,
        loaded: true,
        exports: {
            runServiceTurn: async () => {
                serviceRuns += 1;
            },
        },
        children: [],
        paths: [],
        parent: null,
        path: join(root, "src", "service", "application"),
        require: Module.createRequire(distServiceTurn),
    } as unknown as NodeModule;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    processInboundMessage = require(distProcess).processInboundMessage;
});

afterEach(() => {
    proRuns = 0;
    serviceRuns = 0;
    proShouldThrow = false;
});

describe("processInboundMessage — desvio por attendance_mode", () => {
    it("delivery chama só runProInbound", async () => {
        await processInboundMessage({
            ...baseParams,
            admin: adminWithMode("delivery"),
        });

        assert.equal(proRuns, 1);
        assert.equal(serviceRuns, 0);
    });

    it("service chama só runServiceTurn", async () => {
        await processInboundMessage({
            ...baseParams,
            admin: adminWithMode("service"),
        });

        assert.equal(serviceRuns, 1);
        assert.equal(proRuns, 0);
    });

    it("propaga falha do runProInbound", async () => {
        proShouldThrow = true;
        await assert.rejects(
            () =>
                processInboundMessage({
                    ...baseParams,
                    admin: adminWithMode("delivery"),
                }),
            /pro_pipeline_simulated_failure/
        );
        assert.equal(proRuns, 1);
        assert.equal(serviceRuns, 0);
    });

    it("falha de leitura não entra em nenhum motor", async () => {
        await assert.rejects(
            () =>
                processInboundMessage({
                    ...baseParams,
                    admin: adminWithMode("broken"),
                }),
            /attendance_mode_read/
        );
        assert.equal(proRuns, 0);
        assert.equal(serviceRuns, 0);
    });

    it("empresa ausente não entra em nenhum motor", async () => {
        await assert.rejects(
            () =>
                processInboundMessage({
                    ...baseParams,
                    admin: adminWithMode("missing"),
                }),
            /attendance_mode_read: company_missing/
        );
        assert.equal(proRuns, 0);
        assert.equal(serviceRuns, 0);
    });
});
