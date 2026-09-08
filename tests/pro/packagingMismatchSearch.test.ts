import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { finalizeSearchProdutosForAi } from "../../src/pro/adapters/ai/tools/searchProdutosForAi";
import {
    buildPickClarificationFreeText,
    isPendingPickGroupClarifyEligible,
    resolvePendingPickGroupsFromFreeText,
} from "../../src/pro/pipeline/pendingPickGroups";
import { activeClarifyPickGroups } from "../../src/pro/pipeline/orderWorklist/syncPendingPickGroupsFromWorklist";
import { applySearchResultToLine } from "../../src/pro/pipeline/orderWorklist/applySearchResultToLine";
import { createEmptyOrderWorklist } from "../../src/pro/domain/orderWorklist/orderWorklist";
import type { SupabaseClient } from "@supabase/supabase-js";

const jamelUn = {
    id: "3f4c3031-a267-4378-aaca-c73cef0ed61f",
    product_name: "JAMEL",
    display_name: "JAMEL CACHAÇA JAMEL",
    sigla_comercial: "UN",
    preco_venda: 20,
    fator_conversao: 1,
    produto_id: "e143ffb4-9d5f-4c98-9ebd-425e7d81692c",
    product_volume_id: "8ed742ec-a960-4b67-96a4-8bfab7a561c5",
    descricao: "CACHAÇA JAMEL",
    tags: null,
    volume_quantidade: null,
    unit_type_sigla: null,
    category_id: null,
};

describe("packaging mismatch na busca (CX pedida, só UN)", () => {
    it("finalize: cria group com unavailableRequestedSigla; não é unique prepare", () => {
        const result = finalizeSearchProdutosForAi(
            {
                query: "jamel",
                rows: [jamelUn as never],
                didYouMean: [],
                queryNormalized: "jamel",
                empty: false,
                productIds: [jamelUn.produto_id],
            },
            {
                admin: {} as SupabaseClient,
                catalog: {} as never,
                companyId: "co",
                customerId: null,
                userText: "Quero duas skol tres caixa de jamel e um whisk",
                worklistLineId: "line_jamel",
                worklistLineQuantity: 3,
            }
        );
        assert.ok(result.pendingPickGroup);
        assert.equal(result.pendingPickGroup!.unavailableRequestedSigla, "CX");
        assert.equal(result.pendingPickGroup!.options.length, 1);
        assert.ok(isPendingPickGroupClarifyEligible(result.pendingPickGroup!));

        const wl = createEmptyOrderWorklist();
        wl.lines = [
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
        ];
        const applied = applySearchResultToLine({
            worklist: wl,
            pendingPickGroups: [],
            allowlistIds: [],
            lineId: "line_jamel",
            query: "jamel",
            result,
        });
        assert.equal(applied.uniquePrepareCandidate, null);
        assert.equal(applied.worklist.lines[0]!.status, "ambiguous");
        assert.equal(applied.pendingPickGroups.length, 1);
    });

    it("clarify text + resolve 1/sim; aligned aceita 1 option", () => {
        const result = finalizeSearchProdutosForAi(
            {
                query: "jamel",
                rows: [jamelUn as never],
                didYouMean: [],
                queryNormalized: "jamel",
                empty: false,
                productIds: [jamelUn.produto_id],
            },
            {
                admin: {} as SupabaseClient,
                catalog: {} as never,
                companyId: "co",
                customerId: null,
                userText: "tres caixa de jamel",
                worklistLineId: "line_jamel",
                worklistLineQuantity: 3,
            }
        );
        const g = result.pendingPickGroup!;
        const text = buildPickClarificationFreeText([g]);
        assert.match(text, /Não trabalhamos com caixa/i);
        assert.match(text, /JAMEL/i);
        assert.match(text, /1\./);

        const wl = {
            lines: [
                {
                    id: "line_jamel",
                    rawTerm: "jamel",
                    quantity: 3,
                    status: "ambiguous" as const,
                    searchAttempts: 1,
                    productKey: "jamel",
                    produtoEmbalagemId: null,
                    lastQuery: "jamel",
                    pendingPickGroupKey: "jamel",
                },
            ],
            sealedFromUserTextHash: "h",
            updatedAtIso: new Date().toISOString(),
        };
        const active = activeClarifyPickGroups(wl, [g]);
        assert.equal(active.length, 1);

        const byOne = resolvePendingPickGroupsFromFreeText([g], "1");
        assert.equal(byOne.resolved.length, 1);
        assert.equal(byOne.resolved[0]!.embalagemId, jamelUn.id);
        assert.equal(byOne.resolved[0]!.quantity, 3);

        const bySim = resolvePendingPickGroupsFromFreeText([g], "sim");
        assert.equal(bySim.resolved.length, 1);
        assert.equal(bySim.resolved[0]!.embalagemId, jamelUn.id);
    });

    it("sem CX no texto → unique, sem mismatch group", () => {
        const result = finalizeSearchProdutosForAi(
            {
                query: "jamel",
                rows: [jamelUn as never],
                didYouMean: [],
                queryNormalized: "jamel",
                empty: false,
                productIds: [jamelUn.produto_id],
            },
            {
                admin: {} as SupabaseClient,
                catalog: {} as never,
                companyId: "co",
                customerId: null,
                userText: "quero jamel",
                worklistLineId: "line_jamel",
                worklistLineQuantity: 1,
            }
        );
        assert.equal(result.pendingPickGroup, null);
        assert.equal(result.allowlistIds.length, 1);
    });
});
