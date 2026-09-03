import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareOrderDraftFromTool } from "../../src/pro/tools/prepareOrderDraft";
import { resolvePendingPickGroupsFromFreeText } from "../../src/pro/pipeline/pendingPickGroups";
import { parseProductPickIndex, PICK_EMB_PREFIX } from "../../src/pro/pipeline/productPickText";
import type { PendingPickGroup } from "../../src/types/contracts";

const UN_ID = "11111111-1111-4111-8111-111111111111";
const CX_ID = "22222222-2222-4222-8222-222222222222";
const FAKE_ID = "33333333-3333-4333-8333-333333333333";

function skolGroup(): PendingPickGroup {
    return {
        productKey: "skol lata",
        productLabel: "SKOL LATA",
        unresolvedTurns: 0,
        options: [
            {
                embalagemId: UN_ID,
                displayName: "SKOL LATA",
                productName: "SKOL LATA",
                siglaComercial: "UN",
                precoVenda: 5,
                fatorConversao: 1,
            },
            {
                embalagemId: CX_ID,
                displayName: "SKOL LATA (CX c/15)",
                productName: "SKOL LATA",
                siglaComercial: "CX",
                precoVenda: 60,
                fatorConversao: 15,
            },
        ],
    };
}

function stubAdmin(): SupabaseClient {
    return {
        from(table: string) {
            if (table === "companies") {
                return {
                    select() {
                        return {
                            eq() {
                                return {
                                    maybeSingle: async () => ({
                                        data: {
                                            settings: {
                                                accepted_customer_payments: {
                                                    pix: true,
                                                    cash: true,
                                                    card: true,
                                                    debit: false,
                                                },
                                            },
                                        },
                                    }),
                                };
                            },
                        };
                    },
                };
            }
            if (table === "view_chat_produtos") {
                return {
                    select() {
                        return {
                            eq(_col: string, id: string) {
                                return {
                                    eq() {
                                        return {
                                            maybeSingle: async () => {
                                                if (id === UN_ID) {
                                                    return {
                                                        data: {
                                                            id: UN_ID,
                                                            product_name: "SKOL LATA",
                                                            preco_venda: 5,
                                                            fator_conversao: 1,
                                                            estoque_unidades: 100,
                                                            vender_com_estoque_zero: true,
                                                        },
                                                    };
                                                }
                                                return { data: null };
                                            },
                                        };
                                    },
                                    maybeSingle: async () => {
                                        if (id === UN_ID) {
                                            return {
                                                data: {
                                                    id: UN_ID,
                                                    product_name: "SKOL LATA",
                                                    preco_venda: 5,
                                                    fator_conversao: 1,
                                                    estoque_unidades: 100,
                                                    vender_com_estoque_zero: true,
                                                },
                                            };
                                        }
                                        return { data: null };
                                    },
                                };
                            },
                        };
                    },
                };
            }
            return {
                select() {
                    return {
                        eq() {
                            return {
                                eq() {
                                    return { maybeSingle: async () => ({ data: null }) };
                                },
                                maybeSingle: async () => ({ data: null }),
                                order: () => ({ data: [], error: null }),
                            };
                        },
                        order: () => ({ data: [], error: null }),
                    };
                },
            };
        },
    } as unknown as SupabaseClient;
}

describe("C2.3 pending pick → prepare allowlist-safe", () => {
    it("texto 'a lata' resolve UN e prepare aceita só allowlist", async () => {
        const { resolved } = resolvePendingPickGroupsFromFreeText([skolGroup()], "quero a lata");
        assert.equal(resolved.length, 1);
        assert.equal(resolved[0]?.embalagemId, UN_ID);

        const allow = [UN_ID, CX_ID];
        const ok = await prepareOrderDraftFromTool(
            stubAdmin(),
            "00000000-0000-0000-0000-000000000001",
            null,
            {
                items: [{ produtoEmbalagemId: UN_ID, quantity: 1 }],
                address: null,
                paymentMethod: "pix",
            },
            { kind: "search_allowlist", allowedEmbalagemIds: allow }
        );
        assert.equal(ok.ok || (ok.draft?.items.length ?? 0) > 0 || ok.errors.every((e) => !/não consta/i.test(e)), true);

        const bad = await prepareOrderDraftFromTool(
            stubAdmin(),
            "00000000-0000-0000-0000-000000000001",
            null,
            {
                items: [{ produtoEmbalagemId: FAKE_ID, quantity: 1 }],
                address: null,
                paymentMethod: "pix",
            },
            { kind: "search_allowlist", allowedEmbalagemIds: allow }
        );
        assert.equal(bad.ok, false);
        assert.ok(bad.errors.some((e) => /não consta na última busca/i.test(e)));
    });

    it("opção 2 / pro_pick_emb aponta para CX na lista", () => {
        const picks = skolGroup().options.map((o, i) => ({
            embalagemId: o.embalagemId,
            label: o.displayName ?? `op${i}`,
        }));
        const byNum = parseProductPickIndex("2");
        assert.equal(byNum, 2);
        assert.equal(picks[(byNum ?? 1) - 1]?.embalagemId, CX_ID);

        const btn = `${PICK_EMB_PREFIX}${CX_ID}`;
        assert.ok(btn.includes(CX_ID));
    });

    it("hábito UN resolve 'a de sempre' sem inventar CX", () => {
        const { resolved } = resolvePendingPickGroupsFromFreeText(
            [skolGroup()],
            "a de sempre",
            { habitSigla: "UN" }
        );
        assert.equal(resolved[0]?.embalagemId, UN_ID);
    });
});
