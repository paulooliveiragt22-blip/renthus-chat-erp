/**
 * M5 — notificação "em preparo": sucesso, falhas e texto ao cliente.
 * Não é E2E Meta; cobre enqueue em outbound_jobs (pré-requisito do envio).
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { join } from "path";

type UpsertRow = Record<string, unknown>;

let enqueuePreparingNotify: (p: {
    admin: unknown;
    companyId: string;
    orderId: string;
    orderCode: string;
    customerId: string | null;
}) => Promise<{ enqueued: boolean; reason?: string }>;

let customerPhone: string | null = "5566999999999";
let thread: { id: string; phone_e164: string; channel: string } | null = {
    id: "thread-1",
    phone_e164: "+5566999999999",
    channel: "whatsapp",
};
let upsertError: { message: string } | null = null;
const upserts: UpsertRow[] = [];

function fakeAdmin() {
    return {
        from(table: string) {
            if (table === "customers") {
                return {
                    select: () => ({
                        eq: () => ({
                            eq: () => ({
                                maybeSingle: async () => ({
                                    data: customerPhone != null ? { phone: customerPhone } : null,
                                    error: null,
                                }),
                            }),
                        }),
                    }),
                };
            }
            if (table === "whatsapp_threads") {
                return {
                    select: () => ({
                        eq: () => ({
                            eq: () => ({
                                order: () => ({
                                    limit: () => ({
                                        maybeSingle: async () => ({
                                            data: thread,
                                            error: null,
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                };
            }
            if (table === "outbound_jobs") {
                return {
                    upsert: async (row: UpsertRow) => {
                        upserts.push(row);
                        return { error: upsertError };
                    },
                };
            }
            throw new Error(`unexpected table ${table}`);
        },
    };
}

before(() => {
    const root = join(__dirname, "..", "..");
    const modPath = join(root, "lib", "orders", "enqueuePreparingNotify");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cache = (require as any).cache as Record<string, unknown>;
    delete cache[modPath + ".js"];
    delete cache[modPath + ".ts"];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    enqueuePreparingNotify = require(modPath + ".js").enqueuePreparingNotify;
});

describe("enqueuePreparingNotify (M5)", () => {
    before(() => {
        // reset handled per-it
    });

    it("enfileira texto em preparo com purpose transactional e dedup", async () => {
        customerPhone = "66999999999";
        thread = {
            id: "thread-1",
            phone_e164: "+5566999999999",
            channel: "whatsapp",
        };
        upsertError = null;
        upserts.length = 0;

        const r = await enqueuePreparingNotify({
            admin: fakeAdmin(),
            companyId: "c1",
            orderId: "ord-aaa",
            orderCode: "#ABC123",
            customerId: "cust-1",
        });

        assert.equal(r.enqueued, true);
        assert.equal(upserts.length, 1);
        const row = upserts[0]!;
        assert.equal(row.purpose, "transactional");
        assert.equal(row.dedup_key, "order_preparing:ord-aaa");
        assert.equal(row.source_id, "ord-aaa");
        assert.equal(row.thread_id, "thread-1");
        const payload = row.payload as { kind: string; text: string };
        assert.equal(payload.kind, "text");
        assert.match(payload.text, /em preparo/i);
        assert.match(payload.text, /#ABC123/);
        assert.match(payload.text, /avisamos assim que|pronto para retirada/i);
    });

    it("falha sem customer_id (não viola status)", async () => {
        upserts.length = 0;
        const r = await enqueuePreparingNotify({
            admin: fakeAdmin(),
            companyId: "c1",
            orderId: "ord-1",
            orderCode: "#1",
            customerId: null,
        });
        assert.deepEqual(r, { enqueued: false, reason: "no_customer" });
        assert.equal(upserts.length, 0);
    });

    it("falha sem telefone válido", async () => {
        customerPhone = "123";
        thread = { id: "t", phone_e164: "+55", channel: "whatsapp" };
        upserts.length = 0;
        const r = await enqueuePreparingNotify({
            admin: fakeAdmin(),
            companyId: "c1",
            orderId: "ord-1",
            orderCode: "#1",
            customerId: "cust",
        });
        assert.equal(r.enqueued, false);
        assert.equal(r.reason, "no_phone");
    });

    it("falha sem thread WhatsApp", async () => {
        customerPhone = "5566999999999";
        thread = null;
        upserts.length = 0;
        const r = await enqueuePreparingNotify({
            admin: fakeAdmin(),
            companyId: "c1",
            orderId: "ord-1",
            orderCode: "#1",
            customerId: "cust",
        });
        assert.deepEqual(r, { enqueued: false, reason: "no_thread" });
    });

    it("falha se upsert da fila retorna erro", async () => {
        customerPhone = "5566999999999";
        thread = { id: "t1", phone_e164: "+5566999999999", channel: "whatsapp" };
        upsertError = { message: "db down" };
        upserts.length = 0;
        const r = await enqueuePreparingNotify({
            admin: fakeAdmin(),
            companyId: "c1",
            orderId: "ord-1",
            orderCode: "#1",
            customerId: "cust",
        });
        assert.deepEqual(r, { enqueued: false, reason: "enqueue_failed" });
    });
});
