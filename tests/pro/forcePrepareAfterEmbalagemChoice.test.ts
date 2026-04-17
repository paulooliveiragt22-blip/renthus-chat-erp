import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldForcePrepareAfterEmbalagemChoice } from "../../src/pro/adapters/ai/ai.service.full";

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

    it("returns false when only one id at start", () => {
        assert.equal(
            shouldForcePrepareAfterEmbalagemChoice({
                ...base,
                allowlistAtStart: ["only"],
                allowlistNow: ["only"],
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

    it("returns false when draft já tem itens", () => {
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
