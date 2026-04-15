import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { createHmac } from "node:crypto";
import { join } from "node:path";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

let incomingPost: (req: Request) => Promise<Response>;
let processQueueGet: (req: Request) => Promise<Response>;
let processInboundCalls: Array<Record<string, unknown>> = [];

function clone<T>(v: T): T {
    return JSON.parse(JSON.stringify(v));
}

function matches(row: Row, filters: Array<(r: Row) => boolean>): boolean {
    return filters.every((fn) => fn(row));
}

function makeMockAdmin(tables: Tables) {
    const writes: Array<{ table: string; operation: string; data: unknown }> = [];
    let idSeq = 1;

    function chain(tableName: string, filters: Array<(r: Row) => boolean> = []) {
        const table = tables[tableName] ?? (tables[tableName] = []);
        const api: Record<string, unknown> = {
            select: () => chain(tableName, filters),
            eq: (key: string, value: unknown) => chain(tableName, [...filters, (r) => r[key] === value]),
            in: (key: string, values: unknown[]) => chain(tableName, [...filters, (r) => values.includes(r[key])]),
            lt: (key: string, value: unknown) => chain(tableName, [...filters, (r) => String(r[key] ?? "") < String(value)]),
            gte: (key: string, value: unknown) => chain(tableName, [...filters, (r) => String(r[key] ?? "") >= String(value)]),
            order: () => chain(tableName, filters),
            limit: () => chain(tableName, filters),
            maybeSingle: async () => {
                const row = table.find((r) => matches(r, filters)) ?? null;
                return { data: row, error: null };
            },
            single: async () => {
                const row = table.find((r) => matches(r, filters)) ?? null;
                return { data: row, error: row ? null : { message: "not found" } };
            },
            then: (resolve: (v: unknown) => void) => {
                const data = table.filter((r) => matches(r, filters));
                return Promise.resolve({ data, error: null }).then(resolve);
            },
            insert: (data: Row | Row[]) => {
                const arr = Array.isArray(data) ? data : [data];
                const inserted = arr.map((item) => {
                    const row = { ...item };
                    if (!row.id) row.id = `${tableName}-${idSeq++}`;
                    if (!row.created_at) row.created_at = new Date().toISOString();
                    table.push(row);
                    return row;
                });
                writes.push({ table: tableName, operation: "insert", data: clone(arr) });
                return {
                    select: () => ({
                        single: async () => ({ data: inserted[0] ?? null, error: null }),
                    }),
                    single: async () => ({ data: inserted[0] ?? null, error: null }),
                    then: (resolve: (v: unknown) => void) =>
                        Promise.resolve({ data: inserted, error: null }).then(resolve),
                };
            },
            update: (patch: Row) => {
                const targets = table.filter((r) => matches(r, filters));
                for (const row of targets) Object.assign(row, patch);
                writes.push({ table: tableName, operation: "update", data: clone(patch) });
                return chain(tableName, filters);
            },
            delete: () => {
                const keep: Row[] = [];
                const removed: Row[] = [];
                for (const row of table) {
                    if (matches(row, filters)) removed.push(row);
                    else keep.push(row);
                }
                tables[tableName] = keep;
                writes.push({ table: tableName, operation: "delete", data: clone(removed) });
                return chain(tableName, []);
            },
        };
        return api;
    }

    return {
        client: {
            from: (tableName: string) => chain(tableName),
            rpc: async (name: string, params: Record<string, unknown>) => {
                if (name !== "claim_chatbot_queue_jobs") return { data: null, error: { message: "rpc not found" } };
                const batch = Number(params.batch_size ?? 5);
                const maxAttempts = Number(params.max_attempts ?? 3);
                const queue = tables.chatbot_queue ?? [];
                const pending = queue
                    .filter((j) => j.status === "pending" && Number(j.attempts ?? 0) < maxAttempts)
                    .slice(0, batch);
                for (const job of pending) {
                    job.status = "processing";
                    job.attempts = Number(job.attempts ?? 0) + 1;
                }
                return { data: pending.map((j) => ({ id: j.id })), error: null };
            },
        },
        writes,
        tables,
    };
}

before(() => {
    processInboundCalls = [];
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    process.env.CRON_SECRET = "cron-test-secret";
    process.env.CHATBOT_QUEUE_ENABLED = "1";

    const root = join(__dirname, "..", "..");
    const adminPath = join(root, "lib", "supabase", "admin.js");
    const processMessagePath = join(root, "lib", "chatbot", "processMessage.js");
    const sendPath = join(root, "lib", "whatsapp", "send.js");
    const rateLimitPath = join(root, "lib", "security", "rateLimit.js");
    const channelCredsPath = join(root, "lib", "whatsapp", "channelCredentials.js");
    const incomingPath = join(root, "app", "api", "whatsapp", "incoming", "route.js");
    const queuePath = join(root, "app", "api", "chatbot", "process-queue", "route.js");

    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
    const cache = (require as any).cache as Record<string, unknown>;

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
                processInboundCalls.push(payload);
            },
        },
    };
    cache[sendPath] = {
        id: sendPath,
        filename: sendPath,
        loaded: true,
        exports: {
            sendWhatsAppMessage: async () => ({ ok: true }),
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
});

