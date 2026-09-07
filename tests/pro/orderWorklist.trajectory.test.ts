/**
 * ADR 0011 Fase 4 — trajetória A (sem LLM): extract → search → resolve → prepare gate → respond.
 * Estilo AgentEvals subset/superset, sem LangChain no hot path.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    advanceLineAfterSearch,
    hashUserTextForSeal,
    listLinesByStatus,
    markLineInDraft,
    pendingSearchTermsFromWorklist,
    sealWorklistFromExtract,
    worklistBlocksCheckout,
} from "../../src/pro/domain/orderWorklist/orderWorklist";
import { shouldForceSearchWorklist } from "../../src/pro/pipeline/orderWorklist/advanceWorklistAfterSearch";
import { worklistCheckoutGate } from "../../src/pro/pipeline/orderWorklist/worklistCheckoutGate";
import {
    syncPendingPickGroupsFromWorklist,
    upsertPendingPickGroupForLine,
} from "../../src/pro/pipeline/orderWorklist/syncPendingPickGroupsFromWorklist";
import { shouldForceSearchForDeclaredPendingTerms } from "../../src/pro/adapters/ai/ai.service";
import type { PendingPickGroup } from "../../src/types/contracts";

function sealMulti(userText = "quero whisky e vodka e gin") {
    return sealWorklistFromExtract({
        previous: null,
        userText,
        extracted: [
            { rawTerm: "whisky", quantity: null },
            { rawTerm: "vodka", quantity: 2 },
            { rawTerm: "gin", quantity: 1 },
        ],
    });
}

describe("ADR 0011 trajetória worklist (Fase 4 A)", () => {
    it("selo extract 1×: mesmo hash não re-extrai; termo inventado fora do userText cai fora", () => {
        const userText = "quero skol e original";
        const first = sealWorklistFromExtract({
            previous: null,
            userText,
            extracted: [
                { rawTerm: "skol", quantity: 1 },
                { rawTerm: "original", quantity: 1 },
                { rawTerm: "heineken", quantity: 1 },
            ],
        });
        assert.equal(first.lines.length, 2);
        assert.equal(first.sealedFromUserTextHash, hashUserTextForSeal(userText));

        const second = sealWorklistFromExtract({
            previous: first,
            userText,
            extracted: [{ rawTerm: "skol", quantity: 99 }],
        });
        assert.equal(second, first);
        assert.equal(first.lines[0]?.quantity, 1);
    });

    it("IA [] / extract vazio no mesmo hash: sealWorklistFromExtract no-op se já há lines", () => {
        const userText = "quero whisky e vodka";
        const sealed = sealWorklistFromExtract({
            previous: null,
            userText,
            extracted: [
                { rawTerm: "whisky", quantity: 1 },
                { rawTerm: "vodka", quantity: 1 },
            ],
        });
        const afterEmpty = sealWorklistFromExtract({
            previous: sealed,
            userText,
            extracted: [],
        });
        assert.equal(afterEmpty.lines.length, 2);
        assert.deepEqual(
            pendingSearchTermsFromWorklist(afterEmpty).map((t) => t.toLowerCase()).sort(),
            ["vodka", "whisky"]
        );
    });

    it("multi-item: 2+ hits → N ambiguous + groups com lineId na mesma clarify", () => {
        let wl = sealMulti();
        const [w, v] = wl.lines;
        assert.ok(w && v);

        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "whisky",
            hitCount: 2,
            productKey: "whisky",
            lineId: w.id,
        });
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "vodka",
            hitCount: 2,
            productKey: "vodka",
            lineId: v.id,
        });

        const ambiguous = listLinesByStatus(wl, "ambiguous");
        assert.equal(ambiguous.length, 2);

        let groups: PendingPickGroup[] = [];
        for (const line of ambiguous) {
            groups = upsertPendingPickGroupForLine({
                groups,
                group: {
                    lineId: line.id,
                    productKey: line.productKey ?? line.rawTerm,
                    productLabel: line.rawTerm.toUpperCase(),
                    unresolvedTurns: 0,
                    options: [
                        {
                            embalagemId: `${line.id}-un`,
                            displayName: `${line.rawTerm} UN`,
                            productName: line.rawTerm,
                            siglaComercial: "UN",
                            precoVenda: 10,
                            fatorConversao: 1,
                        },
                        {
                            embalagemId: `${line.id}-cx`,
                            displayName: `${line.rawTerm} CX`,
                            productName: line.rawTerm,
                            siglaComercial: "CX",
                            precoVenda: 50,
                            fatorConversao: 12,
                        },
                    ],
                },
            });
        }
        groups = syncPendingPickGroupsFromWorklist({ worklist: wl, groups });
        assert.equal(groups.length, 2);
        assert.ok(groups.every((g) => g.lineId && ambiguous.some((l) => l.id === g.lineId)));
        assert.equal(worklistBlocksCheckout(wl), true);
        assert.equal(worklistCheckoutGate({ worklist: wl }).blocked, true);
    });

    it("resolve 1 de N: line in_draft; resto ambiguous; sem force-search no pick turn", () => {
        let wl = sealMulti();
        const whisky = wl.lines[0]!;
        const vodka = wl.lines[1]!;
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "whisky",
            hitCount: 2,
            productKey: "whisky",
            lineId: whisky.id,
        });
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "vodka",
            hitCount: 2,
            productKey: "vodka",
            lineId: vodka.id,
        });

        wl = markLineInDraft({
            worklist: wl,
            lineId: whisky.id,
            produtoEmbalagemId: "emb-whisky-cx",
            quantity: 1,
        });

        assert.equal(listLinesByStatus(wl, "in_draft").length, 1);
        assert.equal(listLinesByStatus(wl, "ambiguous").length, 1);
        assert.equal(listLinesByStatus(wl, "pending_search").length, 1); // gin

        assert.equal(
            shouldForceSearchWorklist({ worklist: wl, pickResolveTurn: true }),
            false
        );
        assert.equal(
            shouldForceSearchForDeclaredPendingTerms({
                infoOnly: false,
                pendingTerms: pendingSearchTermsFromWorklist(wl),
                pickResolveTurn: true,
            }),
            false
        );
        // Turno seguinte (sem pick): ainda force-search do gin
        assert.equal(shouldForceSearchWorklist({ worklist: wl, pickResolveTurn: false }), true);
    });

    it("carryover pending_search + not_found após attempts; awaiting_qty bloqueia checkout", () => {
        let wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero xyz",
            extracted: [{ rawTerm: "xyz", quantity: 1 }],
        });
        wl = advanceLineAfterSearch({ worklist: wl, query: "xyz", hitCount: 0 });
        assert.equal(wl.lines[0]!.status, "pending_search");
        wl = advanceLineAfterSearch({ worklist: wl, query: "xyz", hitCount: 0 });
        assert.equal(wl.lines[0]!.status, "not_found");
        assert.equal(worklistBlocksCheckout(wl), false);

        wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero gin",
            extracted: [{ rawTerm: "gin", quantity: null }],
        });
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "gin",
            hitCount: 1,
            produtoEmbalagemId: "emb-gin",
        });
        assert.equal(wl.lines[0]!.status, "awaiting_qty");
        assert.equal(worklistCheckoutGate({ worklist: wl }).reason, "worklist_blocks_checkout");
    });

    it("trajetória canónica (subset): statuses avançam na ordem extract→search→resolve", () => {
        /** Simula sequência de status observados (não tool names de LLM). */
        const trajectory: string[] = [];

        let wl = sealMulti();
        trajectory.push("extract_sealed");
        assert.ok(listLinesByStatus(wl, "pending_search").length >= 2);

        const first = wl.lines[0]!;
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: first.rawTerm,
            hitCount: 2,
            productKey: first.rawTerm,
            lineId: first.id,
        });
        trajectory.push("search_ambiguous");

        assert.equal(
            shouldForceSearchWorklist({ worklist: wl, pickResolveTurn: true }),
            false
        );
        trajectory.push("pick_turn_no_force_search");

        wl = markLineInDraft({
            worklist: wl,
            lineId: first.id,
            produtoEmbalagemId: "e1",
            quantity: 1,
        });
        trajectory.push("resolve_in_draft");

        assert.deepEqual(trajectory, [
            "extract_sealed",
            "search_ambiguous",
            "pick_turn_no_force_search",
            "resolve_in_draft",
        ]);
        // Prepare/respond só após sem pending_search|ambiguous bloqueando o SKU resolvido
        assert.equal(listLinesByStatus(wl, "in_draft").some((l) => l.id === first.id), true);
    });
});
