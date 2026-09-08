import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPort } from "../../src/pro/ports/catalog.port";
import type { ProSessionState } from "../../src/types/contracts";
import { searchPendingWorklistLinesParallel } from "../../src/pro/pipeline/orderWorklist/searchPendingWorklistLinesParallel";
import { createEmptyOrderWorklist } from "../../src/pro/domain/orderWorklist/orderWorklist";

function fakeAdmin(): SupabaseClient {
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

function catalogWithHits(
    byQuery: Record<string, Array<{ id: string; product_name: string; sigla: string }>>
): CatalogPort {
    return {
        async searchDetailed(_companyId, query) {
            const q = String(query).toLowerCase().trim();
            const hits = byQuery[q] ?? [];
            const items = hits.map((h) => ({
                id: h.id,
                product_name: h.product_name,
                display_name: `${h.product_name} (${h.sigla})`,
                sigla_comercial: h.sigla,
                preco_venda: 10,
                fator_conversao: h.sigla === "CX" ? 12 : 1,
                tags: null,
                product_volume_id: `vol-${h.product_name}`,
                produto_id: `prod-${h.product_name}`,
                descricao: null,
                volume_quantidade: null,
                unit_type_sigla: null,
                category_id: null,
            }));
            return {
                items: items as never,
                didYouMean: [],
                queryNormalized: q,
                empty: items.length === 0,
            };
        },
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

describe("searchPendingWorklistLinesParallel", () => {
    it("busca N pending_search em paralelo e marca ambiguous", async () => {
        const wl = createEmptyOrderWorklist();
        wl.lines = [
            {
                id: "l1",
                rawTerm: "skol",
                quantity: 2,
                status: "pending_search",
                searchAttempts: 0,
                productKey: null,
                produtoEmbalagemId: null,
                lastQuery: null,
                pendingPickGroupKey: null,
            },
            {
                id: "l2",
                rawTerm: "jamel",
                quantity: 3,
                status: "pending_search",
                searchAttempts: 0,
                productKey: null,
                produtoEmbalagemId: null,
                lastQuery: null,
                pendingPickGroupKey: null,
            },
        ];
        const res = await searchPendingWorklistLinesParallel({
            admin: fakeAdmin(),
            catalog: catalogWithHits({
                skol: [
                    { id: "skol-un", product_name: "SKOL", sigla: "UN" },
                    { id: "skol-cx", product_name: "SKOL", sigla: "CX" },
                ],
                jamel: [
                    { id: "jamel-un", product_name: "JAMEL", sigla: "UN" },
                    { id: "jamel-cx", product_name: "JAMEL", sigla: "CX" },
                ],
            }),
            companyId: "co1",
            customerId: "c1",
            state: baseState({ orderWorklist: wl }),
            /** Sem contexto de embalagem: UN+CX ficam ambiguous (não colapsam). */
            packagingContextText: "",
        });
        assert.equal(res.searchedLineIds.length, 2);
        assert.deepEqual(
            res.state.orderWorklist?.lines.map((l) => l.status),
            ["ambiguous", "ambiguous"]
        );
        assert.ok((res.state.pendingPickGroups?.length ?? 0) >= 2);
        assert.equal(res.prepareCallCount, 0);
        assert.deepEqual(res.preparedLineIds, []);
    });

    it("expireExhausted: pending com attempts esgotados vira not_found sem rebuscar", async () => {
        const wl = createEmptyOrderWorklist();
        wl.lines = [
            {
                id: "l_skol",
                rawTerm: "skol",
                quantity: 2,
                status: "pending_search",
                searchAttempts: 3,
                productKey: null,
                produtoEmbalagemId: null,
                lastQuery: "skol lata cerveja",
                pendingPickGroupKey: null,
            },
            {
                id: "l_jamel",
                rawTerm: "jamel",
                quantity: 3,
                status: "pending_search",
                searchAttempts: 0,
                productKey: null,
                produtoEmbalagemId: null,
                lastQuery: null,
                pendingPickGroupKey: null,
            },
        ];
        const res = await searchPendingWorklistLinesParallel({
            admin: fakeAdmin(),
            catalog: catalogWithHits({
                jamel: [
                    { id: "jamel-un", product_name: "JAMEL", sigla: "UN" },
                    { id: "jamel-cx", product_name: "JAMEL", sigla: "CX" },
                ],
            }),
            companyId: "co1",
            customerId: "c1",
            state: baseState({ orderWorklist: wl }),
            packagingContextText: "",
        });
        const skol = res.state.orderWorklist?.lines.find((l) => l.id === "l_skol");
        const jamel = res.state.orderWorklist?.lines.find((l) => l.id === "l_jamel");
        assert.equal(skol?.status, "not_found");
        assert.equal(jamel?.status, "ambiguous");
        assert.deepEqual(res.searchedLineIds, ["l_jamel"]);
        assert.equal(res.prepareCallCount, 0);
    });
});
