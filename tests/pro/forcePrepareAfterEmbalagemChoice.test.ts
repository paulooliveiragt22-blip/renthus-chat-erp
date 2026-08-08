import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    shouldForcePrepareAfterEmbalagemChoice,
    shouldForcePrepareAfterUnambiguousSearch,
    shouldForceSearchForPendingMentions,
} from "../../src/pro/adapters/ai/ai.service";

describe("shouldForcePrepareAfterEmbalagemChoice", () => {
    const base = {
        intent: "order_intent",
        step: "pro_collecting_order",
        allowlistAtStart: ["a", "b"],
        allowlistNow: ["b", "a"],
        prepareInvokedThisTurn: false,
        draftItemCount: 0,
    };

    it("returns true when multi-pack allowlist unchanged, no prepare, no draft items", () => {
        assert.equal(shouldForcePrepareAfterEmbalagemChoice(base), true);
    });

    it("returns false when allowlist changed (nova busca)", () => {
        assert.equal(
            shouldForcePrepareAfterEmbalagemChoice({
                ...base,
                allowlistNow: ["x"],
            }),
            false
        );
    });

    it("single-pick allowlist: força prepare mesmo com 1 id", () => {
        assert.equal(
            shouldForcePrepareAfterEmbalagemChoice({
                ...base,
                allowlistAtStart: ["only"],
                allowlistNow: ["only"],
            }),
            true
        );
    });

    it("single-pick com draft parcial: ainda força prepare aditivo", () => {
        assert.equal(
            shouldForcePrepareAfterEmbalagemChoice({
                ...base,
                allowlistAtStart: ["picked"],
                allowlistNow: ["picked"],
                draftItemCount: 2,
            }),
            true
        );
    });

    it("returns false when prepare já rodou neste turno", () => {
        assert.equal(
            shouldForcePrepareAfterEmbalagemChoice({
                ...base,
                prepareInvokedThisTurn: true,
            }),
            false
        );
    });

    it("returns false when draft já tem itens (multi allowlist, sem pick)", () => {
        assert.equal(
            shouldForcePrepareAfterEmbalagemChoice({
                ...base,
                draftItemCount: 1,
            }),
            false
        );
    });

    it("returns false for intent não-pedido", () => {
        assert.equal(
            shouldForcePrepareAfterEmbalagemChoice({
                ...base,
                intent: "faq",
            }),
            false
        );
    });

    it("returns false for step fora de coleta", () => {
        assert.equal(
            shouldForcePrepareAfterEmbalagemChoice({
                ...base,
                step: "pro_awaiting_confirmation",
            }),
            false
        );
    });
});

describe("shouldForcePrepareAfterUnambiguousSearch", () => {
    const base = {
        intent: "order_intent",
        step: "pro_collecting_order",
        prepareInvokedThisTurn: false,
        searchInvokedThisTurn: true,
        allowlistNowCount: 1,
    };

    it("força prepare após search unívoco sem prepare", () => {
        assert.equal(shouldForcePrepareAfterUnambiguousSearch(base), true);
    });

    it("não força com múltiplos hits (cliente precisa escolher)", () => {
        assert.equal(
            shouldForcePrepareAfterUnambiguousSearch({ ...base, allowlistNowCount: 3 }),
            false
        );
    });

    it("não força se prepare já rodou", () => {
        assert.equal(
            shouldForcePrepareAfterUnambiguousSearch({ ...base, prepareInvokedThisTurn: true }),
            false
        );
    });

    it("não força sem search neste turno", () => {
        assert.equal(
            shouldForcePrepareAfterUnambiguousSearch({ ...base, searchInvokedThisTurn: false }),
            false
        );
    });
});

describe("shouldForceSearchForPendingMentions", () => {
    const base = {
        infoOnly: false,
        pendingMentionsCount: 1,
        searchInvokedThisTurn: false,
    };

    it("força search quando há item pendente e nenhuma busca neste turno", () => {
        assert.equal(shouldForceSearchForPendingMentions(base), true);
    });

    it("não força sem itens pendentes", () => {
        assert.equal(
            shouldForceSearchForPendingMentions({ ...base, pendingMentionsCount: 0 }),
            false
        );
    });

    it("não força se já buscou algo neste turno (dá chance de resolver o pendente)", () => {
        assert.equal(
            shouldForceSearchForPendingMentions({ ...base, searchInvokedThisTurn: true }),
            false
        );
    });

    it("não força em modo info_only", () => {
        assert.equal(shouldForceSearchForPendingMentions({ ...base, infoOnly: true }), false);
    });
});
