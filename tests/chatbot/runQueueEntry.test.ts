import assert from "node:assert/strict";
import { before, beforeEach, describe, it } from "node:test";
import { join } from "node:path";
import { makeMockAdmin, type Row, type Tables } from "../helpers/mockSupabaseAdmin";
import type { AdminClient, ChatbotQueueJobRow } from "@/lib/chatbot/queue/types";

/**
 * `runQueueEntryWithOutcome` chama `processQueueJobEntry` (regra de negócio pesada — WhatsApp,
 * IA, etc.) internamente. Aqui isolamos só a orquestração (coalesce → run → done/failed/retry)
 * substituindo `processQueueJobEntry` via `require.cache`, no mesmo padrão de
 * `tests/integration/chatbot-queue-e2e.test.ts`.
 */
let runQueueEntryWithOutcome: typeof import("../../lib/chatbot/queue/runQueueEntry").runQueueEntryWithOutcome;
let processJobEntryMock: (...args: unknown[]) => Promise<void>;

function baseJob(overrides: Partial<ChatbotQueueJobRow> = {}): ChatbotQueueJobRow {
    return {
        id: "job-1",
        created_at: new Date().toISOString(),
        scheduled_at: new Date().toISOString(),
        status: "processing",
        attempts: 0,
        last_error: null,
        company_id: "company-1",
        thread_id: "thread-1",
        phone_e164: "5511999999999",
        message_id: "wamid-1",
        body_text: "quero 2 heineken",
        profile_name: "Cliente",
        messaging_channel: "whatsapp",
        channel_user_id: "5511999999999",
        processing_started_at: new Date().toISOString(),
        metadata: {},
        ...overrides,
    };
}

/** `ChatbotQueueJobRow` é uma interface estrita (sem index signature) — o mock de tabelas
 * (`Row = Record<string, unknown>`) precisa desse cast pra armazenar as linhas de teste. */
function asRow(job: ChatbotQueueJobRow): Row {
    return job as unknown as Row;
}

before(() => {
    const root = join(__dirname, "..", "..");
    const processJobEntryPath = join(root, "lib", "chatbot", "queue", "processJobEntry.js");

    const cache = require.cache as unknown as Record<string, unknown>;
    cache[processJobEntryPath] = {
        id: processJobEntryPath,
        filename: processJobEntryPath,
        loaded: true,
        exports: {
            processQueueJobEntry: (...args: unknown[]) => processJobEntryMock(...args),
        },
    };

    const runQueueEntryPath = join(root, "lib", "chatbot", "queue", "runQueueEntry.js");
    delete cache[runQueueEntryPath];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ({ runQueueEntryWithOutcome } = require(runQueueEntryPath));
});

beforeEach(() => {
    processJobEntryMock = async () => {};
});

describe("runQueueEntryWithOutcome", () => {
    it("processa com sucesso e marca done", async () => {
        const tables: Tables = { chatbot_queue: [asRow(baseJob())] };
        const { client } = makeMockAdmin(tables);
        const job = baseJob();

        const outcome = await runQueueEntryWithOutcome(client as unknown as AdminClient, job, new Set());

        assert.equal(outcome, "processed");
        assert.equal(tables.chatbot_queue[0]?.status, "done");
    });

    it("coalesce: pula processamento quando já visto no batch", async () => {
        let calls = 0;
        processJobEntryMock = async () => {
            calls++;
        };
        const tables: Tables = { chatbot_queue: [asRow(baseJob())] };
        const { client } = makeMockAdmin(tables);
        const job = baseJob({ body_text: "quero 2 heineken" });
        const seenInBatch = new Set<string>(["5511999999999::quero 2 heineken"]);

        const outcome = await runQueueEntryWithOutcome(client as unknown as AdminClient, job, seenInBatch);

        assert.equal(outcome, "coalesced");
        assert.equal(calls, 0, "não deve chamar processQueueJobEntry quando coalescido");
        assert.equal(tables.chatbot_queue[0]?.status, "done");
        assert.equal(tables.chatbot_queue[0]?.last_error, "coalesced_duplicate_inbound");
    });

    it("falha retryable: volta pra pending com backoff quando attempts < MAX_ATTEMPTS", async () => {
        processJobEntryMock = async () => {
            throw new Error("rate limit atingido (429)");
        };
        const tables: Tables = { chatbot_queue: [asRow(baseJob({ attempts: 0 }))] };
        const { client } = makeMockAdmin(tables);
        const job = baseJob({ attempts: 0 });

        const outcome = await runQueueEntryWithOutcome(client as unknown as AdminClient, job, new Set());

        assert.equal(outcome, "failed");
        assert.equal(tables.chatbot_queue[0]?.status, "pending");
        assert.ok(tables.chatbot_queue[0]?.scheduled_at);
    });

    it("falha terminal: marca failed quando attempts atinge MAX_ATTEMPTS", async () => {
        processJobEntryMock = async () => {
            throw new Error("erro qualquer");
        };
        const tables: Tables = { chatbot_queue: [asRow(baseJob({ attempts: 2 }))] };
        const { client } = makeMockAdmin(tables);
        const job = baseJob({ attempts: 2 });

        const outcome = await runQueueEntryWithOutcome(client as unknown as AdminClient, job, new Set());

        assert.equal(outcome, "failed");
        assert.equal(tables.chatbot_queue[0]?.status, "failed");
    });

    it("markProcessingBeforeRun incrementa attempts e marca processing antes de rodar", async () => {
        const tables: Tables = { chatbot_queue: [asRow(baseJob({ attempts: 0, status: "pending" }))] };
        const { client } = makeMockAdmin(tables);
        const job = baseJob({ attempts: 0, status: "pending" });

        let sawStatusDuringRun: unknown;
        processJobEntryMock = async () => {
            sawStatusDuringRun = tables.chatbot_queue[0]?.status;
        };

        await runQueueEntryWithOutcome(client as unknown as AdminClient, job, new Set(), { markProcessingBeforeRun: true });

        assert.equal(sawStatusDuringRun, "processing");
        assert.equal(tables.chatbot_queue[0]?.attempts, 1);
    });
});
