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
