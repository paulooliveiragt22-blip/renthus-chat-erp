import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PendingPickGroup, ProSessionState } from "../../src/types/contracts";
import { serverResolvePendingPicksFromFreeText } from "../../src/pro/pipeline/serverResolvePendingPicks";
import { PENDING_PICK_SAFETY_NET_TURNS } from "../../src/pro/pipeline/pendingPickGroups";

function skolGroup(unresolvedTurns = 0): PendingPickGroup {
    return {
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
        assert.equal(res.outbound.length, 1);
        assert.equal(res.outbound[0]!.kind, "text");
        assert.equal(res.state.pendingPickGroups?.length, 1);
        assert.equal(res.state.pendingPickGroups?.[0]!.unresolvedTurns, 1);
    });

    it("resolve o único grupo pendente por texto: handled=false, pendingPickGroups limpo", async () => {
        const res = await serverResolvePendingPicksFromFreeText({
            admin: fakeAdminAlwaysEmpty(),
            companyId: "company-1",
            customerId: "c1",
            state: baseState({ pendingPickGroups: [skolGroup(0)] }),
            userText: "caixa",
        });
        assert.equal(res.handled, false);
        assert.equal(res.outbound.length, 0);
        assert.deepEqual(res.state.pendingPickGroups, []);
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
        assert.equal(res.state.pendingPickGroups?.length, 0);
    });
});
