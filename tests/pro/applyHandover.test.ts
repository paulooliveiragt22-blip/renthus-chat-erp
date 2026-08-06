import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyProHandover } from "@/src/pro/pipeline/applyHandover";

type FakeRow = Record<string, unknown>;

function makeAdmin(opts: {
    existingTicketId?: string | null;
    failThread?: boolean;
    failTicket?: boolean;
}) {
    const updates: FakeRow[] = [];
    const inserts: FakeRow[] = [];

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
                        return {
                            eq() {
                                return {
                                    eq() {
                                        return {
                                            in() {
                                                return {
                                                    maybeSingle: async () => ({
                                                        data: opts.existingTicketId
                                                            ? { id: opts.existingTicketId }
                                                            : null,
                                                        error: null,
                                                    }),
                                                };
                                            },
                                        };
                                    },
                                };
                            },
                        };
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
                };
            }
            throw new Error(`unexpected table ${table}`);
        },
    };

    return { admin: admin as never, updates, inserts };
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
        });
        assert.equal(r.threadUpdated, true);
        assert.equal(r.ticketCreated, true);
        assert.equal(r.ticketId, "ticket-new");
        assert.equal(updates[0]?.bot_active, false);
        assert.ok(typeof updates[0]?.handover_at === "string");
        assert.equal(inserts[0]?.customer_phone, "+5511999999999");
        assert.equal(inserts[0]?.customer_name, "Ana");
        assert.equal(inserts[0]?.status, "open");
    });

    it("não duplica ticket se já existe open/in_progress", async () => {
        const { admin, inserts } = makeAdmin({ existingTicketId: "ticket-old" });
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
