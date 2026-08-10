import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach, mock } from "node:test";
import { resetMetaGraphThrottleForTests } from "../../lib/whatsapp/metaGraphFetch";
import { sendTypingIndicator } from "../../lib/whatsapp/send";

describe("sendTypingIndicator", () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        resetMetaGraphThrottleForTests();
        process.env.WHATSAPP_MIN_GAP_MS = "0";
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        delete process.env.WHATSAPP_MIN_GAP_MS;
    });

    it("envia status=read + typing_indicator.type=text pro wamid inbound", async () => {
        let capturedUrl = "";
        let capturedBody: Record<string, unknown> = {};
        let capturedAuth = "";
        globalThis.fetch = mock.fn(async (url: string | URL, init?: RequestInit) => {
            capturedUrl = String(url);
            capturedBody = JSON.parse(String(init?.body ?? "{}"));
            capturedAuth = String((init?.headers as Record<string, string>)?.Authorization ?? "");
            return new Response(JSON.stringify({ success: true }), { status: 200 });
        }) as typeof fetch;

        const r = await sendTypingIndicator("wamid.ABC123", {
            phoneNumberId: "1234567890",
            accessToken: "token-xyz",
        });

        assert.equal(r.ok, true);
        assert.equal(capturedUrl, "https://graph.facebook.com/v20.0/1234567890/messages");
        assert.equal(capturedAuth, "Bearer token-xyz");
        assert.deepEqual(capturedBody, {
            messaging_product: "whatsapp",
            status: "read",
            message_id: "wamid.ABC123",
            typing_indicator: { type: "text" },
        });
    });

    it("sem access token/phoneNumberId configurados: não chama a Graph API", async () => {
        const prevToken = process.env.WHATSAPP_TOKEN;
        const prevPhone = process.env.WHATSAPP_PHONE_NUMBER_ID;
        delete process.env.WHATSAPP_TOKEN;
        delete process.env.WHATSAPP_PHONE_NUMBER_ID;

        let called = false;
        globalThis.fetch = mock.fn(async () => {
            called = true;
            return new Response("{}", { status: 200 });
        }) as typeof fetch;

        const r = await sendTypingIndicator("wamid.ABC123");

        if (prevToken !== undefined) process.env.WHATSAPP_TOKEN = prevToken;
        if (prevPhone !== undefined) process.env.WHATSAPP_PHONE_NUMBER_ID = prevPhone;

        assert.equal(r.ok, false);
        assert.equal(r.error, "missing_env_vars_or_wamid");
        assert.equal(called, false);
    });

    it("sem wamid: não chama a Graph API", async () => {
        let called = false;
        globalThis.fetch = mock.fn(async () => {
            called = true;
            return new Response("{}", { status: 200 });
        }) as typeof fetch;

        const r = await sendTypingIndicator("  ", {
            phoneNumberId: "1234567890",
            accessToken: "token-xyz",
        });

        assert.equal(r.ok, false);
        assert.equal(r.error, "missing_env_vars_or_wamid");
        assert.equal(called, false);
    });

    it("erro da Graph API: propaga ok=false sem lançar", async () => {
        globalThis.fetch = mock.fn(async () => {
            return new Response(JSON.stringify({ error: { message: "Invalid parameter" } }), {
                status: 400,
            });
        }) as typeof fetch;

        const r = await sendTypingIndicator("wamid.ABC123", {
            phoneNumberId: "1234567890",
            accessToken: "token-xyz",
        });

        assert.equal(r.ok, false);
        assert.equal(r.error, "Invalid parameter");
    });
});
