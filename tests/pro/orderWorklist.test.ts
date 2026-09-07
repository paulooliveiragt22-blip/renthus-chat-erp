import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    advanceLineAfterSearch,
    applyQuantityToAwaitingLine,
    hashUserTextForSeal,
    hydrateWorklistFromLegacyMentions,
    markLineInDraft,
    pendingSearchTermsFromWorklist,
    sealWorklistFromExtract,
    termAppearsInUserText,
    worklistBlocksCheckout,
} from "../../src/pro/domain/orderWorklist/orderWorklist";
import { collectWorklistInvariantViolations } from "../../src/pro/domain/orderWorklist/worklistInvariants";
import { syncPendingPickGroupsFromWorklist } from "../../src/pro/pipeline/orderWorklist/syncPendingPickGroupsFromWorklist";
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
});
