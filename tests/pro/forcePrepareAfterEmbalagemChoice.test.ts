import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    shouldForcePrepareAfterEmbalagemChoice,
    shouldForcePrepareAfterUnambiguousSearch,
    shouldForceSearchForDeclaredPendingTerms,
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

    it("single-pick allowlist só da sessão: NÃO força prepare (evita tool_choice stale)", () => {
        assert.equal(
            shouldForcePrepareAfterEmbalagemChoice({
                ...base,
                allowlistAtStart: ["only"],
                allowlistNow: ["only"],
            }),
            false
        );
    });

    it("single-pick com draft parcial: também não força (pós-search cobre via UnambiguousSearch)", () => {
        assert.equal(
            shouldForcePrepareAfterEmbalagemChoice({
                ...base,
                allowlistAtStart: ["picked"],
                allowlistNow: ["picked"],
                draftItemCount: 2,
            }),
            false
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
        userText: "quero 2 heineken",
    };

    it("força prepare após search unívoco sem prepare (com qty)", () => {
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

    it("não força sem quantidade explícita (C3.2)", () => {
        assert.equal(
            shouldForcePrepareAfterUnambiguousSearch({ ...base, userText: "quero heineken" }),
            false
        );
    });
});

describe("shouldForceSearchForDeclaredPendingTerms", () => {
    const base = {
        infoOnly: false,
        pendingTerms: ["skol"],
    };

    it("força search quando há termo pendente (carryover ou declarado agora)", () => {
        assert.equal(shouldForceSearchForDeclaredPendingTerms(base), true);
    });

    it("não força com lista vazia", () => {
        assert.equal(
            shouldForceSearchForDeclaredPendingTerms({ ...base, pendingTerms: [] }),
            false
        );
    });

    it("não força em modo info_only mesmo com pendência", () => {
        assert.equal(
            shouldForceSearchForDeclaredPendingTerms({ ...base, infoOnly: true }),
            false
        );
    });
});
