import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ProcessMessageParams } from "../../lib/chatbot/types";
import { makeProPipelineDependencies } from "../../src/pro/pipeline/deps.factory";
import type { SessionRepository } from "../../src/pro/ports/session.repository";

function minimalParams(): ProcessMessageParams {
    return {
        admin: {} as ProcessMessageParams["admin"],
        companyId: "c1",
        threadId: "t1",
        messageId: "m1",
        phoneE164: "+5511999999999",
        text: "oi",
    };
}

describe("makeProPipelineDependencies (R2 overrides)", () => {
    it("substitui portas via overrides sem perder as restantes", () => {
        const customRepo: SessionRepository = {
            load: async () => null,
            save: async () => undefined,
        };
        const deps = makeProPipelineDependencies(minimalParams(), {
            overrides: { sessionRepo: customRepo },
        });
        assert.strictEqual(deps.sessionRepo, customRepo);
        assert.equal(typeof deps.aiService.run, "function");
        assert.equal(typeof deps.orderService.createFromDraft, "function");
    });
});
