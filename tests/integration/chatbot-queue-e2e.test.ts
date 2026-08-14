import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { makeMockAdmin } from "../helpers/mockSupabaseAdmin";

let incomingPost: (req: Request) => Promise<Response>;
let processQueueGet: (req: Request) => Promise<Response>;
let processInboundCalls: Array<Record<string, unknown> & { _start: number; _end: number }> = [];
let inboundDelayMs = 0;

before(() => {
    processInboundCalls = [];
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.CHATBOT_QUEUE_ENABLED = "1";
    process.env.CHATBOT_QUEUE_WAKE_ENABLED = "0";

    const root = join(__dirname, "..", "..");
    const adminPath = join(root, "lib", "supabase", "admin.js");
    const processMessagePath = join(root, "lib", "chatbot", "processMessage.js");
    const sendPath = join(root, "lib", "whatsapp", "send.js");
    const rateLimitPath = join(root, "lib", "security", "rateLimit.js");
    const channelCredsPath = join(root, "lib", "whatsapp", "channelCredentials.js");
    const incomingPath = join(root, "app", "api", "whatsapp", "incoming", "route.js");
    const queuePath = join(root, "app", "api", "chatbot", "process-queue", "route.js");

    const cache = require.cache as unknown as Record<string, unknown>;

    const db = makeMockAdmin({
        whatsapp_channels: [{
            id: "chan-1",
            company_id: "company-1",
            provider: "meta",
            status: "active",
            from_identifier: "5511999999999",
            provider_metadata: {},
            encrypted_access_token: null,
            waba_id: null,
        }],
        whatsapp_threads: [],
        whatsapp_messages: [],
        chatbot_queue: [],
        chatbots: [{ company_id: "company-1", is_active: true, config: {} }],
        chatbot_sessions: [],
    });

    cache[adminPath] = {
        id: adminPath,
        filename: adminPath,
        loaded: true,
        exports: {
            createAdminClient: () => db.client,
        },
    };
    cache[processMessagePath] = {
        id: processMessagePath,
        filename: processMessagePath,
        loaded: true,
        exports: {
            processInboundMessage: async (payload: Record<string, unknown>) => {
                const start = Date.now();
                if (inboundDelayMs > 0) {
                    await new Promise((r) => setTimeout(r, inboundDelayMs));
                }
                processInboundCalls.push({ ...payload, _start: start, _end: Date.now() });
            },
        },
    };
    cache[sendPath] = {
        id: sendPath,
        filename: sendPath,
        loaded: true,
        exports: {
            sendWhatsAppMessage: async () => ({ ok: true }),
            sendTypingIndicator: async () => ({ ok: true }),
        },
    };
    cache[rateLimitPath] = {
        id: rateLimitPath,
        filename: rateLimitPath,
        loaded: true,
        exports: {
            checkRateLimit: () => ({ allowed: true, retryAfterSeconds: 0 }),
        },
    };
    cache[channelCredsPath] = {
        id: channelCredsPath,
        filename: channelCredsPath,
        loaded: true,
        exports: {
            resolveChannelAccessToken: () => "mock-token",
        },
    };

    delete cache[incomingPath];
    delete cache[queuePath];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    incomingPost = require(incomingPath).POST;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    processQueueGet = require(queuePath).GET;
});

describe("chatbot queue e2e", () => {
    it("incoming enfileira e process-queue consome com sucesso", async () => {
        const payload = {
            object: "whatsapp_business_account",
            entry: [{
                changes: [{
                    field: "messages",
                    value: {
                        metadata: { phone_number_id: "5511999999999" },
                        contacts: [{ wa_id: "5511988887777", profile: { name: "Cliente" } }],
                        messages: [{
                            id: "wamid-1",
                            from: "5511988887777",
                            type: "text",
                            text: { body: "quero 2 heineken" },
                        }],
                    },
                }],
            }],
        };
        const rawBody = JSON.stringify(payload);
        const signature = createHmac("sha256", process.env.WHATSAPP_APP_SECRET ?? "")
            .update(rawBody, "utf8")
            .digest("hex");

        const incomingReq = new Request("http://localhost/api/whatsapp/incoming", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-hub-signature-256": `sha256=${signature}`,
            },
            body: rawBody,
        });
        const incomingRes = await incomingPost(incomingReq);
        assert.equal(incomingRes.status, 200);
        assert.equal(processInboundCalls.length, 0, "incoming nao deve processar inline quando fila habilitada");

        const queueReq = new Request("http://localhost/api/chatbot/process-queue", {
            method: "GET",
            headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        });
        const queueRes = await processQueueGet(queueReq);
        assert.equal(queueRes.status, 200);
        const queueJson = await queueRes.json() as { processed?: number; failed?: number };
        assert.equal(queueJson.processed, 1);
        assert.equal(queueJson.failed, 0);
        assert.equal(processInboundCalls.length, 1, "worker deve processar exatamente um job");
        assert.equal(processInboundCalls[0]?.text, "quero 2 heineken");
    });

    it("coalescing: duas mensagens iguais na janela curta viram um processamento real", async () => {
        processInboundCalls = [];
        const payload = {
            object: "whatsapp_business_account",
            entry: [{
                changes: [{
                    field: "messages",
                    value: {
                        metadata: { phone_number_id: "5511999999999" },
                        contacts: [{ wa_id: "5511988887777", profile: { name: "Cliente" } }],
                        messages: [
                            {
                                id: "wamid-dup-1",
                                from: "5511988887777",
                                type: "text",
                                text: { body: "quero 1 heineken" },
                            },
                            {
                                id: "wamid-dup-2",
                                from: "5511988887777",
                                type: "text",
                                text: { body: "quero 1 heineken" },
                            },
                        ],
                    },
                }],
            }],
        };
        const rawBody = JSON.stringify(payload);
        const signature = createHmac("sha256", process.env.WHATSAPP_APP_SECRET ?? "")
            .update(rawBody, "utf8")
            .digest("hex");

        const incomingReq = new Request("http://localhost/api/whatsapp/incoming", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-hub-signature-256": `sha256=${signature}`,
            },
            body: rawBody,
        });
        const incomingRes = await incomingPost(incomingReq);
        assert.equal(incomingRes.status, 200);

        const queueReq = new Request("http://localhost/api/chatbot/process-queue", {
            method: "GET",
            headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
        });
        const queueRes = await processQueueGet(queueReq);
        assert.equal(queueRes.status, 200);
        const queueJson = await queueRes.json() as { processed?: number; failed?: number; coalesced?: number };
        assert.equal(queueJson.processed, 1);
        assert.equal(queueJson.failed, 0);
        assert.ok((queueJson.coalesced ?? 0) <= 1);
        assert.equal(processInboundCalls.length, 1, "apenas uma mensagem deve ser processada de fato");
        assert.equal(processInboundCalls[0]?.text, "quero 1 heineken");
    });

    it("threads/empresas diferentes no mesmo lote processam em paralelo", async () => {
        processInboundCalls = [];
        inboundDelayMs = 50;
        try {
            await postIncoming("wamid-par-a", "5511911111111", "pedido a");
            await postIncoming("wamid-par-b", "5511922222222", "pedido b");

            const t0 = Date.now();
            const queueRes = await processQueueGet(queueRequest());
            const elapsed = Date.now() - t0;
            assert.equal(queueRes.status, 200);
            const json = (await queueRes.json()) as { processed?: number; failed?: number };
            assert.equal(json.processed, 2);
            assert.equal(json.failed, 0);
            assert.equal(processInboundCalls.length, 2);

            const [a, b] = processInboundCalls;
            assert.ok(a && b);
            const overlapped = a._start < b._end && b._start < a._end;
            assert.ok(overlapped, "as duas threads devem estar em voo ao mesmo tempo");
            assert.ok(elapsed < 140, `paralelo deve ser ~1x o delay, não ~2x (elapsed=${elapsed}ms)`);
        } finally {
            inboundDelayMs = 0;
        }
    });

    it("dois jobs da mesma thread no mesmo lote continuam sequenciais", async () => {
        processInboundCalls = [];
        inboundDelayMs = 40;
        try {
            const payload = {
                object: "whatsapp_business_account",
                entry: [{
                    changes: [{
                        field: "messages",
                        value: {
                            metadata: { phone_number_id: "5511999999999" },
                            contacts: [{ wa_id: "5511933333333", profile: { name: "Cliente" } }],
                            messages: [
                                { id: "wamid-seq-1", from: "5511933333333", type: "text", text: { body: "primeiro" } },
                                { id: "wamid-seq-2", from: "5511933333333", type: "text", text: { body: "segundo" } },
                            ],
                        },
                    }],
                }],
            };
            const incomingRes = await incomingPost(signedRequest(payload));
            assert.equal(incomingRes.status, 200);

            const queueRes = await processQueueGet(queueRequest());
            assert.equal(queueRes.status, 200);
            const json = (await queueRes.json()) as { processed?: number; failed?: number };
            assert.equal(json.processed, 2);
            assert.equal(json.failed, 0);
            assert.equal(processInboundCalls.length, 2);
            assert.equal(processInboundCalls[0]?.text, "primeiro");
            assert.equal(processInboundCalls[1]?.text, "segundo");
            const first = processInboundCalls[0];
            const second = processInboundCalls[1];
            assert.ok(first && second);
            assert.ok(
                second._start >= first._end - 2,
                "mesma thread não pode sobrepor processamento"
            );
        } finally {
            inboundDelayMs = 0;
        }
    });
});

function queueRequest(): Request {
    return new Request("http://localhost/api/chatbot/process-queue", {
        method: "GET",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
}

function signedRequest(payload: unknown): Request {
    const rawBody = JSON.stringify(payload);
    const signature = createHmac("sha256", process.env.WHATSAPP_APP_SECRET ?? "")
        .update(rawBody, "utf8")
        .digest("hex");
    return new Request("http://localhost/api/whatsapp/incoming", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            "x-hub-signature-256": `sha256=${signature}`,
        },
        body: rawBody,
    });
}

async function postIncoming(messageId: string, waId: string, text: string): Promise<void> {
    const payload = {
        object: "whatsapp_business_account",
        entry: [{
            changes: [{
                field: "messages",
                value: {
                    metadata: { phone_number_id: "5511999999999" },
                    contacts: [{ wa_id: waId, profile: { name: "Cliente" } }],
                    messages: [{ id: messageId, from: waId, type: "text", text: { body: text } }],
                },
            }],
        }],
    };
    const res = await incomingPost(signedRequest(payload));
    assert.equal(res.status, 200);
}

