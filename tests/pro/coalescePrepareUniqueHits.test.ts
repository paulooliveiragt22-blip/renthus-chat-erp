import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEmptyOrderWorklist } from "../../src/pro/domain/orderWorklist/orderWorklist";
import { coalescePrepareUniqueHits } from "../../src/pro/pipeline/orderWorklist/coalescePrepareUniqueHits";

const COMPANY = "00000000-0000-0000-0000-0000000000c1";
const EMB_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EMB_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function searchingLines() {
    const wl = createEmptyOrderWorklist();
    wl.lines = [
        {
            id: "a",
            rawTerm: "skol",
            quantity: 2,
            status: "searching",
            searchAttempts: 1,
            productKey: null,
            produtoEmbalagemId: EMB_A,
            lastQuery: "skol",
            pendingPickGroupKey: null,
        },
        {
            id: "b",
            rawTerm: "jamel",
            quantity: 3,
            status: "searching",
            searchAttempts: 2,
            productKey: null,
            produtoEmbalagemId: EMB_B,
            lastQuery: "jamel",
            pendingPickGroupKey: null,
        },
    ];
    return wl;
}

/** Pack rows válidos → draft parcial (ok=false por pagamento/endereço). */
function fakeAdminWithPacks(packs: Record<string, { name: string; price: number }>): SupabaseClient {
    return {
        from(table: string) {
            if (table === "view_chat_produtos") {
                return {
                    select() {
                        return {
                            eq(col: string, val: string) {
                                if (col === "id") {
                                    const p = packs[val];
                                    return {
                                        maybeSingle: async () =>
                                            p
                                                ? {
                                                      data: {
                                                          id: val,
                                                          company_id: COMPANY,
                                                          product_name: p.name,
                                                          display_name: p.name,
                                                          descricao: null,
                                                          sigla_comercial: "UN",
                                                          volume_quantidade: null,
                                                          unit_type_sigla: null,
                                                          preco_venda: p.price,
                                                          fator_conversao: 1,
                                                          product_volume_id: null,
                                                          estoque_unidades: 100,
                                                          vender_com_estoque_zero: true,
                                                          produto_id: `prod-${val}`,
                                                      },
                                                  }
                                                : { data: null },
                                    };
                                }
                                return { maybeSingle: async () => ({ data: null }) };
                            },
                        };
                    },
                };
            }
            const terminal = {
                maybeSingle: async () => ({ data: null }),
                order: async () => ({ data: [], error: null }),
                limit: async () => ({ data: [], error: null }),
            };
            const chain: Record<string, unknown> = {
                select: () => chain,
                eq: () => chain,
                in: () => chain,
                order: () => terminal,
                limit: () => terminal,
                maybeSingle: terminal.maybeSingle,
            };
            return chain;
        },
    } as unknown as SupabaseClient;
}

function fakeAdminEmpty(): SupabaseClient {
    const terminal = {
        maybeSingle: async () => ({ data: null }),
        order: async () => ({ data: [], error: null }),
        limit: async () => ({ data: [], error: null }),
    };
    const eqChain: Record<string, unknown> = {
        eq: () => eqChain,
        ...terminal,
        order: () => terminal,
        in: () => terminal,
    };
    return {
        from() {
            return {
                select() {
                    return eqChain;
                },
            };
        },
    } as unknown as SupabaseClient;
}

describe("coalescePrepareUniqueHits", () => {
    it("draft parcial (ok=false) → markLineInDraft; não reverte (smoke jamel)", async () => {
        const wl = searchingLines();
        const res = await coalescePrepareUniqueHits({
            admin: fakeAdminWithPacks({
                [EMB_A]: { name: "SKOL", price: 5 },
                [EMB_B]: { name: "JAMEL", price: 20 },
            }),
            companyId: COMPANY,
            customerId: "c1",
            worklist: wl,
            allowlistIds: [EMB_A, EMB_B],
            draft: null,
            hits: [
                { lineId: "a", produtoEmbalagemId: EMB_A, quantity: 2 },
                { lineId: "b", produtoEmbalagemId: EMB_B, quantity: 3 },
            ],
        });
        assert.equal(res.prepareCallCount, 1);
        assert.equal(res.preparedLineIds.length, 2);
        assert.ok(res.draft?.items?.length === 2);
        assert.ok(res.worklist.lines.every((l) => l.status === "in_draft"));
    });

    it("sem itens no draft → pending_search e desconta searchAttempts", async () => {
        const wl = searchingLines();
        const res = await coalescePrepareUniqueHits({
            admin: fakeAdminEmpty(),
            companyId: COMPANY,
            customerId: "c1",
            worklist: wl,
            allowlistIds: [EMB_A, EMB_B],
            draft: null,
            hits: [
                { lineId: "a", produtoEmbalagemId: EMB_A, quantity: 2 },
                { lineId: "b", produtoEmbalagemId: EMB_B, quantity: 3 },
            ],
        });
        assert.equal(res.prepareCallCount, 1);
        assert.deepEqual(res.preparedLineIds, []);
        assert.ok(res.worklist.lines.every((l) => l.status === "pending_search"));
        assert.equal(res.worklist.lines.find((l) => l.id === "a")!.searchAttempts, 0);
        assert.equal(res.worklist.lines.find((l) => l.id === "b")!.searchAttempts, 1);
    });

    it("zero hits → prepareCallCount 0", async () => {
        const wl = createEmptyOrderWorklist();
        const res = await coalescePrepareUniqueHits({
            admin: fakeAdminEmpty(),
            companyId: COMPANY,
            customerId: null,
            worklist: wl,
            allowlistIds: [],
            draft: null,
            hits: [],
        });
        assert.equal(res.prepareCallCount, 0);
    });
});
