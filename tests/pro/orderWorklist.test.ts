import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    advanceLineAfterSearch,
    applyQuantityToAwaitingLine,
    expireExhaustedPendingSearchLines,
    hashUserTextForSeal,
    hydrateWorklistFromLegacyMentions,
    listLinesByStatus,
    markLineInDraft,
    MAX_SEARCH_ATTEMPTS_PER_LINE,
    pendingSearchTermsFromWorklist,
    reconcileWorklistLinesWithDraft,
    sealWorklistFromExtract,
    termAppearsInUserText,
    termsReferToSame,
    worklistBlocksCheckout,
    worklistHasOrphanInDraftLines,
} from "../../src/pro/domain/orderWorklist/orderWorklist";
import { collectWorklistInvariantViolations } from "../../src/pro/domain/orderWorklist/worklistInvariants";
import {
    activeClarifyPickGroups,
    groupsAfterActiveResolve,
    pendingPickGroupsAlignedWithWorklist,
    syncPendingPickGroupsFromWorklist,
} from "../../src/pro/pipeline/orderWorklist/syncPendingPickGroupsFromWorklist";
import { worklistCheckoutGate } from "../../src/pro/pipeline/orderWorklist/worklistCheckoutGate";
import { shouldForceSearchWorklist } from "../../src/pro/pipeline/orderWorklist/advanceWorklistAfterSearch";

describe("orderWorklist", () => {
    it("seal: multi-item + filtra termo fora do userText", () => {
        const wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero whisky e vodka e gin",
            extracted: [
                { rawTerm: "whisky", quantity: 1 },
                { rawTerm: "vodka", quantity: null },
                { rawTerm: "rum", quantity: 1 },
            ],
        });
        assert.equal(wl.lines.length, 2);
        assert.deepEqual(
            wl.lines.map((l) => l.rawTerm.toLowerCase()).sort(),
            ["vodka", "whisky"]
        );
        assert.ok(wl.sealedFromUserTextHash);
        assert.equal(wl.sealedFromUserTextHash, hashUserTextForSeal("quero whisky e vodka e gin"));
    });

    it("seal: mesmo hash não reseeds", () => {
        const first = sealWorklistFromExtract({
            previous: null,
            userText: "quero skol e original",
            extracted: [
                { rawTerm: "skol", quantity: 2 },
                { rawTerm: "original", quantity: 1 },
            ],
        });
        const second = sealWorklistFromExtract({
            previous: first,
            userText: "quero skol e original",
            extracted: [{ rawTerm: "skol", quantity: 99 }],
        });
        assert.equal(second, first);
        assert.equal(first.lines[0]?.quantity, 2);
    });

    it("seal: extract vazio não apaga worklist anterior", () => {
        const prev = hydrateWorklistFromLegacyMentions({ mentions: ["skol"] });
        const next = sealWorklistFromExtract({
            previous: prev,
            userText: "continua com o pedido",
            extracted: [],
        });
        assert.equal(next, prev);
        assert.equal(next.lines[0]?.rawTerm.toLowerCase(), "skol");
    });

    it("advance: 2+ hits → ambiguous; 1 hit sem qty → awaiting_qty; 0 → not_found após attempts", () => {
        let wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero whisky",
            extracted: [{ rawTerm: "whisky", quantity: null }],
        });
        const lineId = wl.lines[0]!.id;
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "whisky",
            hitCount: 2,
            productKey: "whisky",
            lineId,
        });
        assert.equal(wl.lines[0]!.status, "ambiguous");

        wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero vodka",
            extracted: [{ rawTerm: "vodka", quantity: null }],
        });
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "vodka",
            hitCount: 1,
            produtoEmbalagemId: "emb-1",
        });
        assert.equal(wl.lines[0]!.status, "awaiting_qty");
        assert.equal(wl.lines[0]!.produtoEmbalagemId, "emb-1");

        wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero xyz",
            extracted: [{ rawTerm: "xyz", quantity: 1 }],
        });
        wl = advanceLineAfterSearch({ worklist: wl, query: "xyz", hitCount: 0 });
        assert.equal(wl.lines[0]!.status, "pending_search");
        wl = advanceLineAfterSearch({ worklist: wl, query: "xyz", hitCount: 0 });
        assert.equal(wl.lines[0]!.status, "not_found");
    });

    it("awaiting_qty + qty → in_draft; checkout gate", () => {
        let wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero gin",
            extracted: [{ rawTerm: "gin", quantity: null }],
        });
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "gin",
            hitCount: 1,
            produtoEmbalagemId: "e1",
        });
        assert.equal(worklistBlocksCheckout(wl), true);
        wl = applyQuantityToAwaitingLine({
            worklist: wl,
            lineId: wl.lines[0]!.id,
            quantity: 3,
        });
        assert.equal(wl.lines[0]!.status, "in_draft");
        assert.equal(wl.lines[0]!.quantity, 3);
        assert.equal(worklistBlocksCheckout(wl), false);
        assert.equal(worklistCheckoutGate({ worklist: wl }).blocked, false);
    });

    it("force-search respeita pickResolveTurn", () => {
        const wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero skol e original",
            extracted: [
                { rawTerm: "skol", quantity: 1 },
                { rawTerm: "original", quantity: 1 },
            ],
        });
        assert.equal(shouldForceSearchWorklist({ worklist: wl }), true);
        assert.equal(shouldForceSearchWorklist({ worklist: wl, pickResolveTurn: true }), false);
        assert.deepEqual(
            pendingSearchTermsFromWorklist(wl).map((t) => t.toLowerCase()).sort(),
            ["original", "skol"]
        );
    });

    it("sync groups ↔ ambiguous lines; invariants", () => {
        let wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero skol e original",
            extracted: [
                { rawTerm: "skol", quantity: 2 },
                { rawTerm: "original", quantity: 1 },
            ],
        });
        const skolId = wl.lines[0]!.id;
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "skol",
            hitCount: 2,
            productKey: "skol",
            lineId: skolId,
        });
        const groups = syncPendingPickGroupsFromWorklist({
            worklist: wl,
            groups: [
                {
                    lineId: skolId,
                    productKey: "skol",
                    productLabel: "Skol",
                    unresolvedTurns: 0,
                    options: [
                        {
                            embalagemId: "u1",
                            displayName: "Skol UN",
                            productName: "Skol",
                            siglaComercial: "UN",
                            precoVenda: 5,
                            fatorConversao: 1,
                        },
                    ],
                },
            ],
        });
        assert.equal(groups.length, 1);
        assert.equal(groups[0]!.lineId, skolId);
        assert.equal(
            collectWorklistInvariantViolations({ worklist: wl, pendingPickGroups: groups }).length,
            0
        );
    });

    it("markLineInDraft + termAppearsInUserText", () => {
        assert.equal(termAppearsInUserText("Whisky", "quero whisky e gin"), true);
        assert.equal(termAppearsInUserText("rum", "quero whisky"), false);
        let wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero skol",
            extracted: [{ rawTerm: "skol", quantity: 1 }],
        });
        wl = markLineInDraft({
            worklist: wl,
            lineId: wl.lines[0]!.id,
            produtoEmbalagemId: "emb",
            quantity: 1,
        });
        assert.equal(wl.lines[0]!.status, "in_draft");
    });

    it("termsReferToSame: não colapsa marca curta em segmento multi-item", () => {
        assert.equal(termsReferToSame("skol", "Skol"), true);
        assert.equal(termsReferToSame("skol", "cerveja skol lata"), true);
        assert.equal(termsReferToSame("skol", "skol tres caixa de jamel"), false);
        assert.equal(termsReferToSame("jamel", "skol"), false);
    });

    it("unique+qty → searching até markLineInDraft; orphan bloqueia checkout", () => {
        let wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero duas skol",
            extracted: [{ rawTerm: "skol", quantity: 2 }],
        });
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "skol",
            hitCount: 1,
            produtoEmbalagemId: "emb-skol",
        });
        assert.equal(wl.lines[0]!.status, "searching");
        assert.equal(worklistBlocksCheckout(wl), true);
        assert.equal(
            worklistHasOrphanInDraftLines(wl, { items: [] }),
            false
        );

        wl = markLineInDraft({
            worklist: wl,
            lineId: wl.lines[0]!.id,
            produtoEmbalagemId: "emb-skol",
            quantity: 2,
        });
        assert.equal(wl.lines[0]!.status, "in_draft");
        assert.equal(worklistBlocksCheckout(wl), false);
        assert.equal(worklistHasOrphanInDraftLines(wl, { items: [] }), true);
        assert.equal(
            worklistCheckoutGate({
                worklist: wl,
                state: {
                    orderWorklist: wl,
                    draft: null,
                    pendingPickGroups: [],
                    lastSearchPicks: [],
                },
            }).reason,
            "worklist_orphan_in_draft"
        );
        assert.equal(
            worklistHasOrphanInDraftLines(wl, {
                items: [{ produtoEmbalagemId: "emb-skol" }],
            }),
            false
        );
        assert.equal(
            worklistCheckoutGate({
                worklist: wl,
                state: {
                    orderWorklist: wl,
                    draft: {
                        items: [
                            {
                                produtoEmbalagemId: "emb-skol",
                                quantity: 2,
                                productName: "Skol",
                                unitPrice: 1,
                                lineTotal: 2,
                            },
                        ],
                    } as never,
                    pendingPickGroups: [],
                    lastSearchPicks: [],
                },
            }).blocked,
            false
        );
    });

    it("seal mesmo hash enriquece linhas faltantes (selo incompleto)", () => {
        const userText = "Quero duas skol tres caixa de jamel e um whisk";
        let wl = sealWorklistFromExtract({
            previous: null,
            userText,
            extracted: [
                { rawTerm: "skol", quantity: 2 },
                { rawTerm: "whisk", quantity: 1 },
            ],
        });
        assert.equal(wl.lines.length, 2);
        wl = sealWorklistFromExtract({
            previous: wl,
            userText,
            extracted: [
                { rawTerm: "skol", quantity: 2 },
                { rawTerm: "jamel", quantity: 3 },
                { rawTerm: "whisk", quantity: 1 },
            ],
        });
        assert.equal(wl.lines.length, 3);
        assert.ok(wl.lines.some((l) => /jamel/i.test(l.rawTerm)));
    });

    it("reconcile draft→in_draft; force-search respeita cap attempts", () => {
        let wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero skol e whisk",
            extracted: [
                { rawTerm: "skol", quantity: 2 },
                { rawTerm: "whisk", quantity: 1 },
            ],
        });
        const skolId = wl.lines[0]!.id;
        wl = {
            ...wl,
            lines: wl.lines.map((l) =>
                l.id === skolId
                    ? {
                          ...l,
                          status: "pending_search" as const,
                          produtoEmbalagemId: "emb-skol",
                          searchAttempts: 2,
                      }
                    : l
            ),
        };
        wl = reconcileWorklistLinesWithDraft(wl, {
            items: [{ produtoEmbalagemId: "emb-skol" }],
        });
        assert.equal(wl.lines.find((l) => l.id === skolId)!.status, "in_draft");
        assert.equal(shouldForceSearchWorklist({ worklist: wl }), true);
        /** Órfão: line in_draft fora do carrinho → abandoned (não bloqueia pagamento). */
        wl = reconcileWorklistLinesWithDraft(wl, {
            items: [{ produtoEmbalagemId: "emb-other" }],
        });
        assert.equal(wl.lines.find((l) => l.id === skolId)!.status, "abandoned");
        assert.equal(worklistHasOrphanInDraftLines(wl, { items: [{ produtoEmbalagemId: "emb-other" }] }), false);
        wl = {
            ...wl,
            lines: wl.lines.map((l) =>
                l.rawTerm === "whisk"
                    ? { ...l, searchAttempts: MAX_SEARCH_ATTEMPTS_PER_LINE }
                    : l
            ),
        };
        assert.equal(shouldForceSearchWorklist({ worklist: wl }), false);
        wl = expireExhaustedPendingSearchLines(wl);
        assert.equal(wl.lines.find((l) => l.rawTerm === "whisk")!.status, "not_found");
    });

    it("D8: activeClarifyPickGroups = 1; force-search off com ambiguous; dedupe lineId", () => {
        let wl = sealWorklistFromExtract({
            previous: null,
            userText: "quero skol e jamel e whisk",
            extracted: [
                { rawTerm: "skol", quantity: 2 },
                { rawTerm: "jamel", quantity: 3 },
                { rawTerm: "whisk", quantity: 1 },
            ],
        });
        const [skol, jamel, whisk] = wl.lines;
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "skol",
            hitCount: 2,
            productKey: "skol",
            lineId: skol!.id,
        });
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "jamel",
            hitCount: 2,
            productKey: "jamel",
            lineId: jamel!.id,
        });
        wl = advanceLineAfterSearch({
            worklist: wl,
            query: "whisk",
            hitCount: 4,
            productKey: "whisk",
            lineId: whisk!.id,
        });
        assert.equal(listLinesByStatus(wl, "ambiguous").length, 3);
        assert.equal(shouldForceSearchWorklist({ worklist: wl }), false);

        const opt = (id: string) => ({
            embalagemId: id,
            displayName: id,
            productName: id,
            siglaComercial: "UN",
            precoVenda: 1,
            fatorConversao: 1,
        });
        const groups = [
            {
                lineId: skol!.id,
                productKey: "skol",
                productLabel: "Skol",
                unresolvedTurns: 0,
                options: [opt("s1"), opt("s2")],
            },
            {
                lineId: jamel!.id,
                productKey: "jamel",
                productLabel: "Jamel",
                unresolvedTurns: 0,
                options: [opt("j1"), opt("j2")],
            },
            {
                lineId: whisk!.id,
                productKey: "whisk",
                productLabel: "Whisk",
                unresolvedTurns: 0,
                options: [opt("w1"), opt("w2")],
            },
            {
                lineId: whisk!.id,
                productKey: "whisky",
                productLabel: "Whisky dup",
                unresolvedTurns: 0,
                options: [opt("w1"), opt("w2"), opt("w3")],
            },
        ];
        const aligned = pendingPickGroupsAlignedWithWorklist(wl, groups);
        assert.equal(aligned.length, 3);
        assert.equal(aligned.filter((g) => g.lineId === whisk!.id).length, 1);
        assert.ok((aligned.find((g) => g.lineId === whisk!.id)?.options.length ?? 0) >= 3);

        const active = activeClarifyPickGroups(wl, groups);
        assert.equal(active.length, 1);
        assert.equal(active[0]!.lineId, skol!.id);

        const after = groupsAfterActiveResolve({
            worklist: wl,
            allGroups: aligned,
            activeGroups: active,
            remaining: [],
        });
        assert.equal(after.length, 2);
        assert.ok(after.every((g) => g.lineId !== skol!.id));
    });
});
