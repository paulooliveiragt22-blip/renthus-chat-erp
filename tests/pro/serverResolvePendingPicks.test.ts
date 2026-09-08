import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PendingPickGroup, ProSessionState } from "../../src/types/contracts";
import { serverResolvePendingPicksFromFreeText } from "../../src/pro/pipeline/serverResolvePendingPicks";
import { PENDING_PICK_SAFETY_NET_TURNS } from "../../src/pro/pipeline/pendingPickGroups";

function skolGroup(unresolvedTurns = 0): PendingPickGroup {
    return {
        lineId: "line_skol",
        productKey: "skol lata",
        productLabel: "SKOL LATA",
        unresolvedTurns,
        options: [
            {
                embalagemId: "skol-un",
                displayName: "SKOL LATA",
                productName: "SKOL LATA",
                siglaComercial: "UN",
                precoVenda: 5,
                fatorConversao: 1,
            },
            {
                embalagemId: "skol-cx",
                displayName: "SKOL LATA (CX c/15)",
                productName: "SKOL LATA",
                siglaComercial: "CX",
                precoVenda: 60,
                fatorConversao: 15,
            },
        ],
    };
}

function baseState(overrides: Partial<ProSessionState> = {}): ProSessionState {
    return {
        step: "pro_collecting_order",
        customerId: "c1",
        misunderstandingStreak: 0,
        escalationTier: 0,
        draft: null,
        aiHistory: [],
        searchProdutoEmbalagemIds: [],
        ...overrides,
    };
}

/** Sem dados reais: qualquer prepare falha no load do pack, mas nunca lança exceção. */
function fakeAdminAlwaysEmpty(): SupabaseClient {
    const terminal = {
        maybeSingle: async () => ({ data: null }),
        order: async () => ({ data: [], error: null }),
        limit: async () => ({ data: [], error: null }),
    };
    const eqChain: Record<string, unknown> = {
        eq: () => eqChain,
        ...terminal,
        order: () => terminal,
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

describe("serverResolvePendingPicksFromFreeText", () => {
    it("sem pendingPickGroups: no-op (handled=false)", async () => {
        const res = await serverResolvePendingPicksFromFreeText({
            admin: fakeAdminAlwaysEmpty(),
            companyId: "company-1",
            customerId: "c1",
            state: baseState({ pendingPickGroups: [] }),
            userText: "oi",
        });
        assert.equal(res.handled, false);
        assert.equal(res.continueToCheckoutWithoutAi, false);
        assert.equal(res.outbound.length, 0);
    });

    it("texto não esclarece nada: handled=true com pergunta consolidada, unresolvedTurns++", async () => {
        const res = await serverResolvePendingPicksFromFreeText({
            admin: fakeAdminAlwaysEmpty(),
            companyId: "company-1",
            customerId: "c1",
            state: baseState({ pendingPickGroups: [skolGroup(0)] }),
            userText: "quero 20",
        });
        assert.equal(res.handled, true);
        assert.equal(res.continueToCheckoutWithoutAi, false);
        assert.equal(res.outbound.length, 1);
        assert.equal(res.outbound[0]!.kind, "text");
        assert.equal(res.state.pendingPickGroups?.length, 1);
        assert.equal(res.state.pendingPickGroups?.[0]!.unresolvedTurns, 1);
    });

    it("resolve o único grupo pendente por texto: checkout sem IA + ack canônico", async () => {
        const res = await serverResolvePendingPicksFromFreeText({
            admin: fakeAdminAlwaysEmpty(),
            companyId: "company-1",
            customerId: "c1",
            state: baseState({ pendingPickGroups: [skolGroup(0)] }),
            userText: "caixa",
        });
        assert.equal(res.handled, false);
        assert.equal(res.continueToCheckoutWithoutAi, true);
        assert.deepEqual(res.state.pendingPickGroups, []);
        assert.ok(res.outbound.some((m) => m.kind === "text" && /Anotei/u.test(String(m.text))));
        assert.ok(res.outbound.some((m) => /CX|caixa/i.test(String(m.text))));
    });

    it("resolve pick mas worklist ainda tem pending_search: NÃO checkout sem IA", async () => {
        const res = await serverResolvePendingPicksFromFreeText({
            admin: fakeAdminAlwaysEmpty(),
            companyId: "company-1",
            customerId: "c1",
            catalog: {
                async searchDetailed() {
                    return {
                        items: [],
                        didYouMean: [],
                        queryNormalized: "",
                        empty: true,
                    };
                },
            },
            state: baseState({
                pendingPickGroups: [skolGroup(0)],
                orderWorklist: {
                    lines: [
                        {
                            id: "line_skol",
                            rawTerm: "skol",
                            quantity: 2,
                            status: "ambiguous",
                            searchAttempts: 1,
                            productKey: "skol lata",
                            produtoEmbalagemId: null,
                            lastQuery: "skol",
                            pendingPickGroupKey: "skol lata",
                        },
                        {
                            id: "line_jamel",
                            rawTerm: "jamel",
                            quantity: 3,
                            status: "pending_search",
                            searchAttempts: 0,
                            productKey: null,
                            produtoEmbalagemId: null,
                            lastQuery: null,
                            pendingPickGroupKey: null,
                        },
                    ],
                    sealedFromUserTextHash: "h1",
                    updatedAtIso: new Date().toISOString(),
                },
            }),
            userText: "1",
        });
        assert.equal(res.continueToCheckoutWithoutAi, false);
        assert.equal(res.handled, true);
        assert.deepEqual(res.state.pendingPickGroups, []);
        assert.ok(
            res.state.orderWorklist?.lines.some(
                (l) => l.rawTerm === "jamel" && (l.status === "pending_search" || l.status === "not_found")
            )
        );
        assert.ok(res.outbound.some((m) => /localizar|jamel/i.test(String(m.text))));
    });

    it("pós-pick: batch search encontra irmão → clarify no mesmo turno", async () => {
        const res = await serverResolvePendingPicksFromFreeText({
            admin: fakeAdminAlwaysEmpty(),
            companyId: "company-1",
            customerId: "c1",
            catalog: {
                async searchDetailed(_c, query) {
                    if (String(query).toLowerCase().includes("jamel")) {
                        return {
                            items: [
                                {
                                    id: "jamel-un",
                                    product_name: "JAMEL",
                                    display_name: "JAMEL (UN)",
                                    sigla_comercial: "UN",
                                    preco_venda: 20,
                                    fator_conversao: 1,
                                    produto_id: "p-jamel",
                                    product_volume_id: "v-jamel",
                                    descricao: null,
                                    volume_quantidade: null,
                                    unit_type_sigla: null,
                                    category_id: null,
                                    tags: null,
                                },
                                {
                                    id: "jamel-cx",
                                    product_name: "JAMEL",
                                    display_name: "JAMEL (CX)",
                                    sigla_comercial: "CX",
                                    preco_venda: 200,
                                    fator_conversao: 12,
                                    produto_id: "p-jamel",
                                    product_volume_id: "v-jamel",
                                    descricao: null,
                                    volume_quantidade: null,
                                    unit_type_sigla: null,
                                    category_id: null,
                                    tags: null,
                                },
                            ] as never,
                            didYouMean: [],
                            queryNormalized: "jamel",
                            empty: false,
                        };
                    }
                    return {
                        items: [],
                        didYouMean: [],
                        queryNormalized: "",
                        empty: true,
                    };
                },
            },
            state: baseState({
                pendingPickGroups: [skolGroup(0)],
                orderWorklist: {
                    lines: [
                        {
                            id: "line_skol",
                            rawTerm: "skol",
                            quantity: 2,
                            status: "ambiguous",
                            searchAttempts: 1,
                            productKey: "skol lata",
                            produtoEmbalagemId: null,
                            lastQuery: "skol",
                            pendingPickGroupKey: "skol lata",
                        },
                        {
                            id: "line_jamel",
                            rawTerm: "jamel",
                            quantity: 3,
                            status: "pending_search",
                            searchAttempts: 0,
                            productKey: null,
                            produtoEmbalagemId: null,
                            lastQuery: null,
                            pendingPickGroupKey: null,
                        },
                    ],
                    sealedFromUserTextHash: "h1",
                    updatedAtIso: new Date().toISOString(),
                },
            }),
            userText: "1",
        });
        assert.equal(res.continueToCheckoutWithoutAi, false);
        assert.equal(res.handled, true);
        assert.equal(res.state.pendingPickGroups?.length, 1);
        assert.equal(res.state.pendingPickGroups?.[0]?.lineId, "line_jamel");
        assert.ok(
            res.state.orderWorklist?.lines.some(
                (l) => l.id === "line_jamel" && l.status === "ambiguous"
            )
        );
        assert.ok(res.outbound.some((m) => /JAMEL|jamel|opção|Selecione/i.test(String(m.text))));
    });

    it("D8: 2 ambiguous no estado → resolve só o ativo; irmão permanece; clarify 1", async () => {
        const jamel: PendingPickGroup = {
            lineId: "line_jamel",
            productKey: "jamel",
            productLabel: "JAMEL",
            unresolvedTurns: 0,
            options: [
                {
                    embalagemId: "jamel-un",
                    displayName: "JAMEL UN",
                    productName: "JAMEL",
                    siglaComercial: "UN",
                    precoVenda: 20,
                    fatorConversao: 1,
                },
                {
                    embalagemId: "jamel-cx",
                    displayName: "JAMEL CX",
                    productName: "JAMEL",
                    siglaComercial: "CX",
                    precoVenda: 200,
                    fatorConversao: 12,
                },
            ],
        };
        const res = await serverResolvePendingPicksFromFreeText({
            admin: fakeAdminAlwaysEmpty(),
            companyId: "company-1",
            customerId: "c1",
            state: baseState({
                pendingPickGroups: [skolGroup(0), jamel],
                orderWorklist: {
                    lines: [
                        {
                            id: "line_skol",
                            rawTerm: "skol",
                            quantity: 2,
                            status: "ambiguous",
                            searchAttempts: 1,
                            productKey: "skol lata",
                            produtoEmbalagemId: null,
                            lastQuery: "skol",
                            pendingPickGroupKey: "skol lata",
                        },
                        {
                            id: "line_jamel",
                            rawTerm: "jamel",
                            quantity: 3,
                            status: "ambiguous",
                            searchAttempts: 1,
                            productKey: "jamel",
                            produtoEmbalagemId: null,
                            lastQuery: "jamel",
                            pendingPickGroupKey: "jamel",
                        },
                    ],
                    sealedFromUserTextHash: "h-d8",
                    updatedAtIso: new Date().toISOString(),
                },
            }),
            userText: "1",
        });
        assert.equal(res.handled, true);
        assert.equal(res.continueToCheckoutWithoutAi, false);
        assert.equal(res.state.pendingPickGroups?.length, 1);
        assert.equal(res.state.pendingPickGroups?.[0]?.lineId, "line_jamel");
        const clarifyOnly = res.outbound
            .filter((m) => m.kind === "text")
            .map((m) => String(m.text))
            .filter((t) => !/Anotei/u.test(t))
            .join("\n");
        assert.match(clarifyOnly, /JAMEL/i);
        assert.doesNotMatch(clarifyOnly, /SKOL LATA/i);
    });

    it("resolve 1 de 2: ack do item + clarifica o restante (sem IA)", async () => {
        const original: PendingPickGroup = {
            lineId: "line_original",
            productKey: "original 600ml",
            productLabel: "ORIGINAL 600ML",
            unresolvedTurns: 0,
            options: [
                {
                    embalagemId: "orig-un",
                    displayName: "ORIGINAL 600ML",
                    productName: "ORIGINAL 600ML",
                    siglaComercial: "UN",
                    precoVenda: 15,
                    fatorConversao: 1,
                },
                {
                    embalagemId: "orig-cx",
                    displayName: "ORIGINAL 600ML (CX c/24)",
                    productName: "ORIGINAL 600ML",
                    siglaComercial: "CX",
                    precoVenda: 360,
                    fatorConversao: 24,
                },
            ],
        };
        const res = await serverResolvePendingPicksFromFreeText({
            admin: fakeAdminAlwaysEmpty(),
            companyId: "company-1",
            customerId: "c1",
            state: baseState({ pendingPickGroups: [skolGroup(0), original] }),
            userText: "quero caixa de skol",
        });
        assert.equal(res.handled, true);
        assert.equal(res.continueToCheckoutWithoutAi, false);
        assert.equal(res.state.pendingPickGroups?.length, 1);
        assert.equal(res.state.pendingPickGroups?.[0]!.productKey, "original 600ml");
        const texts = res.outbound.filter((m) => m.kind === "text").map((m) => String(m.text));
        assert.ok(texts.some((t) => /Anotei/u.test(t) && /skol/i.test(t)));
        assert.ok(texts.some((t) => /ORIGINAL|opção|Selecione/i.test(t)));
        assert.ok(!texts.some((t) => /whisky|whiskey/i.test(t)));
    });

    it("grupo passou do teto de tentativas: escala para botão determinístico", async () => {
        const res = await serverResolvePendingPicksFromFreeText({
            admin: fakeAdminAlwaysEmpty(),
            companyId: "company-1",
            customerId: "c1",
            state: baseState({
                pendingPickGroups: [skolGroup(PENDING_PICK_SAFETY_NET_TURNS)],
            }),
            userText: "quero 20",
        });
        assert.equal(res.handled, true);
        assert.ok(res.outbound.some((m) => m.kind === "buttons"));
        /** Escalados permanecem no pending até o cliente escolher (não órfão com draft parcial). */
        assert.equal(res.state.pendingPickGroups?.length, 1);
        assert.ok((res.state.lastSearchPicks?.length ?? 0) >= 2);
    });
});
