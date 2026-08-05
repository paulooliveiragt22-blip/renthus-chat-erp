import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import {
    metaGraphPostJson,
    resetMetaGraphThrottleForTests,
} from "../../lib/whatsapp/metaGraphFetch";

describe("metaGraphFetch", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        resetMetaGraphThrottleForTests();
        process.env.WHATSAPP_MIN_GAP_MS = "0";
        process.env.WHATSAPP_429_MAX_RETRIES = "2";
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        delete process.env.WHATSAPP_MIN_GAP_MS;
        delete process.env.WHATSAPP_429_MAX_RETRIES;
    });

    it("retenta 429 e retorna sucesso", async () => {
        let calls = 0;
        globalThis.fetch = mock.fn(async () => {
            calls += 1;
            if (calls < 2) {
                return new Response(JSON.stringify({ error: { message: "throttled" } }), {
                    status: 429,
                    headers: { "retry-after": "0" },
                });
            }
            return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), {
                status: 200,
            });
        }) as typeof fetch;

        const r = await metaGraphPostJson("phone1", "https://graph.facebook.com/v20.0/phone1/messages", {
            accessToken: "t",
            body: { messaging_product: "whatsapp" },
        });

        assert.equal(r.ok, true);
        assert.equal(r.status, 200);
        assert.equal(calls, 2);
        const messages = r.json.messages as Array<{ id: string }>;
        assert.equal(messages[0]?.id, "wamid.1");
    });

    it("propaga erro não-429 sem retry", async () => {
        let calls = 0;
        globalThis.fetch = mock.fn(async () => {
            calls += 1;
            return new Response(JSON.stringify({ error: { message: "bad" } }), { status: 400 });
        }) as typeof fetch;

        const r = await metaGraphPostJson("phone2", "https://example.test/msg", {
            accessToken: "t",
            body: {},
        });

        assert.equal(r.ok, false);
        assert.equal(r.status, 400);
        assert.equal(calls, 1);
    });
});
