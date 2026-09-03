import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    buildCoalesceKey,
    hasRecentEquivalentProcessed,
    isCriticalOrderConfirmationText,
    normalizeInboundText,
} from "@/lib/chatbot/queue/coalesce";
import { makeMockAdmin } from "../helpers/mockSupabaseAdmin";
import type { AdminClient, ChatbotQueueJobRow } from "@/lib/chatbot/queue/types";

type MinimalJob = Pick<
    ChatbotQueueJobRow,
    "id" | "thread_id" | "phone_e164" | "company_id" | "body_text" | "metadata"
>;

describe("normalizeInboundText", () => {
    it("remove acentos, normaliza espaços e caixa", () => {
        assert.equal(normalizeInboundText("  Quéro   2 Heineken!  "), "quero 2 heineken!");
        assert.equal(normalizeInboundText("SIM"), "sim");
    });
});

describe("isCriticalOrderConfirmationText", () => {
    it("reconhece só IDs de botão que fecham/cancelam pedido (ADR-0005 C1)", () => {
        assert.equal(isCriticalOrderConfirmationText("pro_confirm_order"), true);
        assert.equal(isCriticalOrderConfirmationText("btn_confirm_order"), true);
        assert.equal(isCriticalOrderConfirmationText("pro_cancel_order"), true);
        assert.equal(isCriticalOrderConfirmationText("btn_cancel_order"), true);
    });

    it("prosa sim/ok/confirmar NÃO é crítica (já não finaliza pedido)", () => {
        assert.equal(isCriticalOrderConfirmationText("sim"), false);
        assert.equal(isCriticalOrderConfirmationText("confirmar"), false);
        assert.equal(isCriticalOrderConfirmationText("pode confirmar"), false);
    });

    it("não marca texto normal como confirmação crítica", () => {
        assert.equal(isCriticalOrderConfirmationText("quero 2 heineken"), false);
        assert.equal(isCriticalOrderConfirmationText(""), false);
    });
});

describe("buildCoalesceKey", () => {
    it("retorna null para confirmação crítica por botão (nunca coalescer)", () => {
        const key = buildCoalesceKey("thread-1", "5511999999999", "company-1", "pro_confirm_order");
        assert.equal(key, null);
    });

    it("retorna null para texto curto (<=6 chars normalizados)", () => {
        assert.equal(buildCoalesceKey("thread-1", "5511999999999", "company-1", "oi"), null);
        assert.ok(buildCoalesceKey("thread-1", "5511999999999", "company-1", "oi tudo bem"));
    });

    it("retorna null para mensagem interativa", () => {
        const key = buildCoalesceKey(
            "thread-1",
            "5511999999999",
            "company-1",
            "quero 2 heineken",
            "interactive"
        );
        assert.equal(key, null);
    });

    it("gera chave estável para o mesmo texto (case/acento-insensitive)", () => {
        const a = buildCoalesceKey("thread-1", "5511999999999", "company-1", "Quero 2 Heineken");
        const b = buildCoalesceKey("thread-1", "5511999999999", "company-1", "quero   2 heineken");
        assert.ok(a);
        assert.equal(a, b);
    });

    it("usa phone_e164 como owner preferencial sobre thread/company", () => {
        const withPhone = buildCoalesceKey("thread-1", "5511999999999", "company-1", "quero 2 heineken");
        const withoutPhone = buildCoalesceKey("thread-1", null, "company-1", "quero 2 heineken");
        assert.notEqual(withPhone, withoutPhone);
    });

    it("retorna null sem bodyText", () => {
        assert.equal(buildCoalesceKey("thread-1", "5511999999999", "company-1", null), null);
    });
});

describe("hasRecentEquivalentProcessed", () => {
    it("detecta job equivalente recente (mesmo phone + texto) com status done", async () => {
        const now = new Date().toISOString();
        const { client } = makeMockAdmin({
            chatbot_queue: [
                {
                    id: "job-old",
                    thread_id: "thread-1",
                    phone_e164: "5511999999999",
                    company_id: "company-1",
                    body_text: "quero 2 heineken",
                    status: "done",
                    created_at: now,
                    metadata: {},
                },
            ],
        });
        const job = {
            id: "job-new",
            thread_id: "thread-1",
            phone_e164: "5511999999999",
            company_id: "company-1",
            body_text: "quero 2 heineken",
            metadata: {},
        };
        const key = buildCoalesceKey(job.thread_id, job.phone_e164, job.company_id, job.body_text);
        assert.ok(key);
        const found = await hasRecentEquivalentProcessed(client as unknown as AdminClient, job as MinimalJob, key);
        assert.equal(found, true);
    });

    it("ignora o próprio job ao comparar", async () => {
        const now = new Date().toISOString();
        const { client } = makeMockAdmin({
            chatbot_queue: [
                {
                    id: "job-new",
                    thread_id: "thread-1",
                    phone_e164: "5511999999999",
                    company_id: "company-1",
                    body_text: "quero 2 heineken",
                    status: "processing",
                    created_at: now,
                    metadata: {},
                },
            ],
        });
        const job = {
            id: "job-new",
            thread_id: "thread-1",
            phone_e164: "5511999999999",
            company_id: "company-1",
            body_text: "quero 2 heineken",
            metadata: {},
        };
        const key = buildCoalesceKey(job.thread_id, job.phone_e164, job.company_id, job.body_text);
        assert.ok(key);
        const found = await hasRecentEquivalentProcessed(client as unknown as AdminClient, job as MinimalJob, key);
        assert.equal(found, false);
    });

    it("retorna false quando não há registros equivalentes", async () => {
        const { client } = makeMockAdmin({ chatbot_queue: [] });
        const job = {
            id: "job-new",
            thread_id: "thread-1",
            phone_e164: "5511999999999",
            company_id: "company-1",
            body_text: "quero 2 heineken",
            metadata: {},
        };
        const key = buildCoalesceKey(job.thread_id, job.phone_e164, job.company_id, job.body_text);
        assert.ok(key);
        const found = await hasRecentEquivalentProcessed(client as unknown as AdminClient, job as MinimalJob, key);
        assert.equal(found, false);
    });
});
