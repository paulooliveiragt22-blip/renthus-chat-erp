import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyProHandover } from "@/src/pro/pipeline/applyHandover";

type FakeRow = Record<string, unknown>;

function makeAdmin(opts: {
    existingByThreadId?: string | null;
    existingByPhoneId?: string | null;
    failThread?: boolean;
    failTicket?: boolean;
}) {
    const updates: FakeRow[] = [];
    const inserts: FakeRow[] = [];
    const ticketUpdates: FakeRow[] = [];

    function ticketSelectChain(kind: "thread" | "phone") {
        const resultId =
            kind === "thread" ? opts.existingByThreadId : opts.existingByPhoneId;
        const terminal = {
            in() {
                return {
                    maybeSingle: async () => ({
                        data: resultId ? { id: resultId } : null,
                        error: null,
                    }),
                };
            },
        };
        return {
            eq(_col: string, _val: unknown) {
                // company_id then thread_id/phone
                return {
                    eq(_col2: string, _val2: unknown) {
                        return terminal;
                    },
                    ...terminal,
                };
            },
        };
    }

    let selectCall = 0;

    const admin = {
        from(table: string) {
            if (table === "whatsapp_threads") {
                return {
                    update(payload: FakeRow) {
                        updates.push({ table, ...payload });
                        return {
                            eq() {
                                return {
                                    eq: async () =>
                                        opts.failThread
                                            ? { error: { message: "thread boom" } }
                                            : { error: null },
                                };
                            },
                        };
                    },
                };
            }
            if (table === "support_tickets") {
                return {
                    select() {
                        selectCall += 1;
                        const kind = selectCall === 1 ? "thread" : "phone";
                        return ticketSelectChain(kind);
                    },
                    insert(payload: FakeRow) {
                        inserts.push(payload);
                        return {
                            select() {
                                return {
                                    single: async () =>
                                        opts.failTicket
                                            ? { data: null, error: { message: "ticket boom" } }
                                            : { data: { id: "ticket-new" }, error: null },
                                };
                            },
                        };
                    },
                    update(payload: FakeRow) {
                        ticketUpdates.push(payload);
                        return {
                            eq: async () => ({ error: null }),
                        };
                    },
                };
            }
            throw new Error(`unexpected table ${table}`);
        },
    };

    return { admin: admin as never, updates, inserts, ticketUpdates };
}

describe("applyProHandover", () => {
    it("desliga bot e cria ticket quando não há aberto", async () => {
        const { admin, updates, inserts } = makeAdmin({});
        const r = await applyProHandover({
            admin,
            companyId: "c1",
            threadId: "t1",
            phoneE164: "+5511999999999",
            customerName: "Ana",
            channel: "whatsapp",
        });
        assert.equal(r.threadUpdated, true);
        assert.equal(r.ticketCreated, true);
        assert.equal(r.ticketId, "ticket-new");
        assert.equal(updates[0]?.bot_active, false);
        assert.ok(typeof updates[0]?.handover_at === "string");
        assert.equal(inserts[0]?.customer_phone, "+5511999999999");
        assert.equal(inserts[0]?.thread_id, "t1");
        assert.equal(inserts[0]?.channel, "whatsapp");
        assert.equal(inserts[0]?.customer_name, "Ana");
        assert.equal(inserts[0]?.status, "open");
    });

    it("cria ticket IG sem telefone", async () => {
        const { admin, inserts } = makeAdmin({});
        const r = await applyProHandover({
            admin,
            companyId: "c1",
            threadId: "tig",
            phoneE164: "",
            customerId: "cust-1",
            customerName: "Cliente Instagram",
            channel: "instagram",
        });
        assert.equal(r.ticketCreated, true);
        assert.equal(inserts[0]?.customer_phone, null);
        assert.equal(inserts[0]?.customer_id, "cust-1");
        assert.equal(inserts[0]?.channel, "instagram");
        assert.equal(inserts[0]?.thread_id, "tig");
    });

    it("não duplica ticket se já existe open/in_progress na thread", async () => {
        const { admin, inserts } = makeAdmin({ existingByThreadId: "ticket-old" });
        const r = await applyProHandover({
            admin,
            companyId: "c1",
            threadId: "t1",
            phoneE164: "+5511888888888",
        });
        assert.equal(r.ticketCreated, false);
        assert.equal(r.ticketId, "ticket-old");
        assert.equal(inserts.length, 0);
    });

    it("propaga erro de update da thread", async () => {
        const { admin } = makeAdmin({ failThread: true });
        await assert.rejects(
            () =>
                applyProHandover({
                    admin,
                    companyId: "c1",
                    threadId: "t1",
                    phoneE164: "+5511777777777",
                }),
            /handover_thread_update/
        );
    });
});
