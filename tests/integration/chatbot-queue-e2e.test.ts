import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { join } from "node:path";
import { makeMockAdmin } from "../helpers/mockSupabaseAdmin";

let incomingPost: (req: Request) => Promise<Response>;
let processInboundJobById: (
    admin: unknown,
    jobId: string,
    opts?: { markProcessingBeforeRun?: boolean }
) => Promise<{ ok: boolean; outcome?: string; error?: string }>;
let processInboundCalls: Array<Record<string, unknown> & { _start: number; _end: number }> = [];
let inboundDelayMs = 0;
let mockDb: ReturnType<typeof makeMockAdmin>;

before(() => {
    processInboundCalls = [];
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.CHATBOT_QUEUE_ENABLED = "1";

    const root = join(__dirname, "..", "..");
    const adminPath = join(root, "lib", "supabase", "admin.js");
    const processMessagePath = join(root, "lib", "chatbot", "processMessage.js");
    const processInboundPath = join(root, "lib", "chatbot", "queue", "processInboundJobById.js");
    const sendPath = join(root, "lib", "whatsapp", "send.js");
    const rateLimitPath = join(root, "lib", "security", "rateLimit.js");
    const channelCredsPath = join(root, "lib", "whatsapp", "channelCredentials.js");
    const inboundGatePath = join(root, "lib", "billing", "canProcessInboundChannel.js");
    const afterEnqueuePath = join(root, "lib", "queue", "afterEnqueue.js");
    const incomingPath = join(root, "app", "api", "whatsapp", "incoming", "route.js");

    const cache = require.cache as unknown as Record<string, unknown>;

    mockDb = makeMockAdmin({
        companies: [{
            id: "company-1",
            is_active: true,
        }],
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
            createAdminClient: () => mockDb.client,
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
            checkRateLimit: () => ({ allowed: true, retryAfterSeconds: 0, remaining: 99 }),
            requesterIp: () => "127.0.0.1",
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
    cache[inboundGatePath] = {
        id: inboundGatePath,
        filename: inboundGatePath,
        loaded: true,
        exports: {
            canProcessInboundChannel: async () => ({ allowed: true as const }),
        },
    };
    cache[afterEnqueuePath] = {
        id: afterEnqueuePath,
        filename: afterEnqueuePath,
        loaded: true,
        exports: {
            scheduleInboundAfterEnqueue: () => {},
            scheduleOutboundAfterEnqueue: () => {},
            scheduleOutboundAfterEnqueueLookup: () => {},
        },
    };

    delete cache[incomingPath];
    delete cache[processInboundPath];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    incomingPost = require(incomingPath).POST;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    processInboundJobById = require(processInboundPath).processInboundJobById;
});

function resetQueueState() {
    mockDb.tables.chatbot_queue = [];
    mockDb.tables.whatsapp_threads = [];
    mockDb.tables.whatsapp_messages = [];
    mockDb.tables.chatbot_sessions = [];
    processInboundCalls = [];
}

async function drainPendingJobs(options?: { parallel?: boolean }) {
    type QRow = { id: string; created_at: string; status: string };
    const pending = ((mockDb.tables.chatbot_queue ?? []) as QRow[]).filter(
        (j) => j.status === "pending" || j.status === "processing"
    );
    const seenInBatch = new Set<string>();
    const runOne = async (jobId: string) => {
        const r = await processInboundJobById(mockDb.client, jobId, {
            markProcessingBeforeRun: true,
            seenInBatch,
        } as { markProcessingBeforeRun?: boolean; seenInBatch?: Set<string> });
        if (!r.ok && r.error === "job_not_runnable") return;
        assert.equal(r.ok, true, `job ${jobId} should process (${r.ok === false ? r.error : ""})`);
    };
    if (options?.parallel) {
        await Promise.all(pending.map((j) => runOne(j.id)));
    } else {
        for (const j of pending.sort((a, b) => a.created_at.localeCompare(b.created_at))) {
            await runOne(j.id);
        }
    }
}

describe("chatbot queue e2e (SQS worker path via processInboundJobById)", () => {
    it("incoming enfileira e worker consome com sucesso", async () => {
        resetQueueState();
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
        const incomingRes = await incomingPost(signedRequest(payload));
        assert.equal(incomingRes.status, 200);
        assert.equal(processInboundCalls.length, 0, "incoming nao deve processar inline quando fila habilitada");

        await drainPendingJobs();
        assert.equal(processInboundCalls.length, 1, "worker deve processar exatamente um job");
        assert.equal(processInboundCalls[0]?.text, "quero 2 heineken");
    });

    it("coalescing: duas mensagens iguais na janela curta viram um processamento real", async () => {
        resetQueueState();
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
        const incomingRes = await incomingPost(signedRequest(payload));
        assert.equal(incomingRes.status, 200);

        await drainPendingJobs();
        assert.equal(processInboundCalls.length, 1, "apenas uma mensagem deve ser processada de fato");
        assert.equal(processInboundCalls[0]?.text, "quero 1 heineken");
    });

    it("threads/empresas diferentes no mesmo lote processam em paralelo", async () => {
        resetQueueState();
        inboundDelayMs = 50;
        try {
            await postIncoming("wamid-par-a", "5511911111111", "pedido a");
            await postIncoming("wamid-par-b", "5511922222222", "pedido b");

            const t0 = Date.now();
            await drainPendingJobs({ parallel: true });
            const elapsed = Date.now() - t0;
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

    it("dois jobs da mesma thread processam em sequência (FIFO / drain sequencial)", async () => {
        resetQueueState();
        inboundDelayMs = 40;
        const threadId = "thread-seq-1";
        try {
            mockDb.tables.chatbot_queue.push(
                {
                    id: "job-seq-1",
                    created_at: new Date(Date.now() - 2000).toISOString(),
                    scheduled_at: new Date().toISOString(),
                    status: "pending",
                    attempts: 0,
                    company_id: "company-1",
                    thread_id: threadId,
                    phone_e164: "+5511933333333",
                    message_id: "wamid-seq-1",
                    body_text: "mensagem numero um",
                    metadata: { message_type: "text" },
                },
                {
                    id: "job-seq-2",
                    created_at: new Date(Date.now() - 1000).toISOString(),
                    scheduled_at: new Date().toISOString(),
                    status: "pending",
                    attempts: 0,
                    company_id: "company-1",
                    thread_id: threadId,
                    phone_e164: "+5511933333333",
                    message_id: "wamid-seq-2",
                    body_text: "mensagem numero dois",
                    metadata: { message_type: "text" },
                }
            );
            mockDb.tables.whatsapp_threads.push({
                id: threadId,
                company_id: "company-1",
                bot_active: true,
                phone_e164: "+5511933333333",
            });
            mockDb.tables.chatbots = [{ company_id: "company-1", is_active: true, config: {} }];

            await drainPendingJobs();
            const terminal = mockDb.tables.chatbot_queue.filter(
                (j) => j.status === "done" || j.status === "failed"
            );
            assert.equal(terminal.length, 2, "ambos jobs devem terminar");
            assert.ok(processInboundCalls.length >= 1);
            if (processInboundCalls.length >= 2) {
                const first = processInboundCalls[0];
                const second = processInboundCalls[1];
                assert.ok(first && second);
                assert.ok(second._start >= first._end - 2);
            }
        } finally {
            inboundDelayMs = 0;
        }
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
