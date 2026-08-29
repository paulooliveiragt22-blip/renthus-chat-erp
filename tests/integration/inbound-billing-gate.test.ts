/**
 * B4.2 — Integração: inbound WA / worker drop silencioso quando TenantAccess deny.
 * Usa canProcessInboundChannel real (sem mock always-allow).
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { makeMockAdmin } from "../helpers/mockSupabaseAdmin";

let incomingPost: (req: Request) => Promise<Response>;
let processQueueJobEntry: (admin: unknown, job: Record<string, unknown>) => Promise<void>;
let processInboundCalls: unknown[] = [];
let mockDb: ReturnType<typeof makeMockAdmin>;

const COMPANY_ID = "company-never-paid";
const PHONE_NUMBER_ID = "5511999999999";

function denyTables() {
    return {
        companies: [{ id: COMPANY_ID, is_active: false }],
        pagarme_subscriptions: [{
            company_id: COMPANY_ID,
            status: "pending_payment",
            trial_ends_at: null,
            last_paid_at: null,
            plan: "pro",
        }],
        whatsapp_channels: [{
            id: "chan-deny",
            company_id: COMPANY_ID,
            provider: "meta",
            status: "active",
            from_identifier: PHONE_NUMBER_ID,
            provider_metadata: {},
            encrypted_access_token: null,
            waba_id: null,
        }],
        whatsapp_threads: [],
        whatsapp_messages: [],
        chatbot_queue: [],
        chatbots: [{ company_id: COMPANY_ID, is_active: true, config: {} }],
        chatbot_sessions: [],
    };
}

before(() => {
    processInboundCalls = [];
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    process.env.CHATBOT_QUEUE_ENABLED = "1";

    const root = join(__dirname, "..", "..");
    const paths = {
        admin: join(root, "lib", "supabase", "admin.js"),
        processMessage: join(root, "lib", "chatbot", "processMessage.js"),
        send: join(root, "lib", "whatsapp", "send.js"),
        rateLimit: join(root, "lib", "security", "rateLimitDistributed.js"),
        rateLimitLegacy: join(root, "lib", "security", "rateLimit.js"),
        channelCreds: join(root, "lib", "whatsapp", "channelCredentials.js"),
        afterEnqueue: join(root, "lib", "queue", "afterEnqueue.js"),
        incoming: join(root, "app", "api", "whatsapp", "incoming", "route.js"),
        processJobEntry: join(root, "lib", "chatbot", "queue", "processJobEntry.js"),
        pendingOrder: join(root, "src", "pro", "pipeline", "resolvePendingOrderConfirmation.js"),
    };

    mockDb = makeMockAdmin(denyTables());

    const cache = require.cache as unknown as Record<string, unknown>;

    cache[paths.admin] = {
        id: paths.admin,
        filename: paths.admin,
        loaded: true,
        exports: { createAdminClient: () => mockDb.client },
    };
    cache[paths.processMessage] = {
        id: paths.processMessage,
        filename: paths.processMessage,
        loaded: true,
        exports: {
            processInboundMessage: async (payload: unknown) => {
                processInboundCalls.push(payload);
            },
        },
    };
    cache[paths.send] = {
        id: paths.send,
        filename: paths.send,
        loaded: true,
        exports: {
            sendWhatsAppMessage: async () => ({ ok: true }),
            sendTypingIndicator: async () => ({ ok: true }),
        },
    };
    cache[paths.rateLimit] = {
        id: paths.rateLimit,
        filename: paths.rateLimit,
        loaded: true,
        exports: {
            checkRateLimitAsync: async () => ({ allowed: true, retryAfterSeconds: 0, remaining: 99 }),
        },
    };
    cache[paths.rateLimitLegacy] = {
        id: paths.rateLimitLegacy,
        filename: paths.rateLimitLegacy,
        loaded: true,
        exports: { requesterIp: () => "127.0.0.1" },
    };
    cache[paths.channelCreds] = {
        id: paths.channelCreds,
        filename: paths.channelCreds,
        loaded: true,
        exports: { resolveChannelAccessToken: () => "mock-token" },
    };
    cache[paths.afterEnqueue] = {
        id: paths.afterEnqueue,
        filename: paths.afterEnqueue,
        loaded: true,
        exports: {
            scheduleInboundAfterEnqueue: () => {},
            scheduleOutboundAfterEnqueue: () => {},
        },
    };
    cache[paths.pendingOrder] = {
        id: paths.pendingOrder,
        filename: paths.pendingOrder,
        loaded: true,
        exports: { tryResolvePendingOrderConfirmation: async () => null },
    };

    // canProcessInboundChannel REAL — não entra no cache mock

    delete cache[paths.incoming];
    delete cache[paths.processJobEntry];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    incomingPost = require(paths.incoming).POST;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    processQueueJobEntry = require(paths.processJobEntry).processQueueJobEntry;
});

describe("B4.2 inbound billing gate (integração)", () => {
    it("WA incoming pending_payment → 200 silencioso, sem fila nem processamento", async () => {
        processInboundCalls = [];
        mockDb.tables.chatbot_queue = [];
        mockDb.tables.whatsapp_messages = [];

        const payload = {
            object: "whatsapp_business_account",
            entry: [{
                changes: [{
                    field: "messages",
                    value: {
                        metadata: { phone_number_id: PHONE_NUMBER_ID },
                        contacts: [{ wa_id: "5511988887777", profile: { name: "Cliente" } }],
                        messages: [{
                            id: "wamid-deny-1",
                            from: "5511988887777",
                            type: "text",
                            text: { body: "quero pedir" },
                        }],
                    },
                }],
            }],
        };

        const res = await incomingPost(signedRequest(payload));
        assert.strictEqual(res.status, 200);
        assert.strictEqual(mockDb.tables.chatbot_queue?.length ?? 0, 0, "não enfileira");
        assert.strictEqual(mockDb.tables.whatsapp_messages?.length ?? 0, 0, "não persiste mensagem");
        assert.strictEqual(processInboundCalls.length, 0, "não processa bot");
    });

    it("processJobEntry pending_payment → skip sem processInboundMessage", async () => {
        processInboundCalls = [];
        const now = new Date().toISOString();
        await processQueueJobEntry(mockDb.client, {
            id: "job-deny-1",
            created_at: now,
            scheduled_at: now,
            company_id: COMPANY_ID,
            thread_id: "thread-1",
            phone_e164: "+5511988887777",
            message_id: "wamid-deny-2",
            body_text: "oi",
            messaging_channel: "whatsapp",
            status: "pending",
            attempts: 0,
            last_error: null,
            profile_name: null,
            channel_user_id: null,
            processing_started_at: null,
            metadata: null,
        });
        assert.strictEqual(processInboundCalls.length, 0);
    });
});

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
