import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHATBOT_SESSION_PRO_V2_STATE_KEY } from "@/src/pro/adapters/supabase/session.repository.supabase";

/**
 * Mock deferido: `.update(patch).eq(...).is(...)` aplica o patch só no fim da cadeia
 * (igual PostgREST), para testar consumeCheckoutHandoff sem o mock genérico
 * que aplica update antes dos filtros.
 */
function makeDeferredUpdateAdmin(tables: Record<string, Record<string, unknown>[]>) {
    function chain(tableName: string, filters: Array<(r: Record<string, unknown>) => boolean>, pendingPatch: Record<string, unknown> | null) {
        const table = tables[tableName] ?? (tables[tableName] = []);
        const applyPending = () => {
            if (!pendingPatch) return;
            for (const row of table) {
                if (filters.every((f) => f(row))) Object.assign(row, pendingPatch);
            }
        };
        const api: Record<string, unknown> = {
            select: () => chain(tableName, filters, pendingPatch),
            eq: (key: string, value: unknown) =>
                chain(tableName, [...filters, (r) => r[key] === value], pendingPatch),
            is: (key: string, value: unknown) =>
                chain(tableName, [
                    ...filters,
                    (r) => (value === null ? r[key] == null : r[key] === value),
                ], pendingPatch),
            gt: (key: string, value: unknown) =>
                chain(tableName, [...filters, (r) => String(r[key] ?? "") > String(value)], pendingPatch),
            update: (patch: Record<string, unknown>) => chain(tableName, filters, { ...patch }),
            maybeSingle: async () => {
                applyPending();
                const row = table.find((r) => filters.every((f) => f(r))) ?? null;
                return { data: row, error: null };
            },
            then: (resolve: (v: unknown) => void) => {
                applyPending();
                return Promise.resolve({ data: null, error: null }).then(resolve);
            },
        };
        return api;
    }
    return {
        from: (tableName: string) => chain(tableName, [], null),
    } as unknown as SupabaseClient;
}

describe("consumeCheckoutHandoffAfterWebOrder (C1b.3)", () => {
    before(() => {
        if (!process.env.WEB_MENU_SESSION_SECRET) {
            process.env.WEB_MENU_SESSION_SECRET = "test-secret-consume-handoff-c1b3";
        }
    });

    it("sem token → no-op", async () => {
        const { consumeCheckoutHandoffAfterWebOrder } = await import(
            "@/lib/public-menu/handoff/consumeCheckoutHandoff"
        );
        const admin = makeDeferredUpdateAdmin({});
        const r = await consumeCheckoutHandoffAfterWebOrder(admin, {
            companyId: "c1",
            slug: "loja",
            handoffToken: null,
        });
        assert.equal(r.consumed, false);
        assert.equal(r.reason, "no_token");
    });

    it("com hc válido: marca consumed_at e limpa draft da thread", async () => {
        const { signMenuHandoffToken } = await import("@/lib/public-menu/sessionToken");
        const { consumeCheckoutHandoffAfterWebOrder } = await import(
            "@/lib/public-menu/handoff/consumeCheckoutHandoff"
        );

        const companyId = "11111111-1111-1111-1111-111111111111";
        const handoffId = "22222222-2222-2222-2222-222222222222";
        const threadId = "thread-wa-1";
        const slug = "loja-demo";
        const future = new Date(Date.now() + 3600_000).toISOString();

        const tables: Record<string, Record<string, unknown>[]> = {
            menu_handoffs: [
                {
                    id: handoffId,
                    company_id: companyId,
                    slug,
                    thread_id: threadId,
                    consumed_at: null,
                    expires_at: future,
                },
            ],
            chatbot_sessions: [
                {
                    id: "sess-1",
                    company_id: companyId,
                    thread_id: threadId,
                    customer_id: "cust-1",
                    expires_at: future,
                    context: {
                        [CHATBOT_SESSION_PRO_V2_STATE_KEY]: {
                            step: "pro_awaiting_confirmation",
                            customerId: "cust-1",
                            misunderstandingStreak: 0,
                            escalationTier: 0,
                            draft: { items: [{ produtoEmbalagemId: "x" }], version: 1 },
                            aiHistory: [],
                            searchProdutoEmbalagemIds: [],
                        },
                    },
                },
            ],
            whatsapp_order_confirmations: [
                {
                    id: "conf-1",
                    company_id: companyId,
                    thread_id: threadId,
                    status: "pending",
                },
            ],
        };

        const admin = makeDeferredUpdateAdmin(tables);
        const token = signMenuHandoffToken({ handoffId, companyId, slug });

        const r = await consumeCheckoutHandoffAfterWebOrder(admin, {
            companyId,
            slug,
            handoffToken: token,
        });

        assert.equal(r.consumed, true);
        assert.equal(r.threadId, threadId);
        assert.equal(r.draftCleared, true);
        assert.ok(tables.menu_handoffs[0]!.consumed_at);
        const state = (tables.chatbot_sessions[0]!.context as Record<string, unknown>)[
            CHATBOT_SESSION_PRO_V2_STATE_KEY
        ] as { step: string; draft: unknown };
        assert.equal(state.step, "pro_idle");
        assert.equal(state.draft, null);
        assert.equal(tables.whatsapp_order_confirmations[0]!.status, "cancelled");
    });

    it("idempotente se já consumido: ainda limpa draft", async () => {
        const { signMenuHandoffToken } = await import("@/lib/public-menu/sessionToken");
        const { consumeCheckoutHandoffAfterWebOrder } = await import(
            "@/lib/public-menu/handoff/consumeCheckoutHandoff"
        );

        const companyId = "11111111-1111-1111-1111-111111111111";
        const handoffId = "33333333-3333-3333-3333-333333333333";
        const threadId = "thread-wa-2";
        const slug = "loja-demo";
        const future = new Date(Date.now() + 3600_000).toISOString();

        const tables: Record<string, Record<string, unknown>[]> = {
            menu_handoffs: [
                {
                    id: handoffId,
                    company_id: companyId,
                    slug,
                    thread_id: threadId,
                    consumed_at: "2026-01-01T00:00:00.000Z",
                    expires_at: future,
                },
            ],
            chatbot_sessions: [
                {
                    id: "sess-2",
                    company_id: companyId,
                    thread_id: threadId,
                    customer_id: null,
                    expires_at: future,
                    context: {
                        [CHATBOT_SESSION_PRO_V2_STATE_KEY]: {
                            step: "pro_collecting_order",
                            customerId: null,
                            misunderstandingStreak: 0,
                            escalationTier: 0,
                            draft: { items: [], version: 1 },
                            aiHistory: [],
                            searchProdutoEmbalagemIds: [],
                        },
                    },
                },
            ],
            whatsapp_order_confirmations: [],
        };

        const admin = makeDeferredUpdateAdmin(tables);
        const token = signMenuHandoffToken({ handoffId, companyId, slug });
        const r = await consumeCheckoutHandoffAfterWebOrder(admin, {
            companyId,
            slug,
            handoffToken: token,
        });
        assert.equal(r.consumed, true);
        assert.equal(r.draftCleared, true);
        assert.equal(tables.menu_handoffs[0]!.consumed_at, "2026-01-01T00:00:00.000Z");
    });
});
