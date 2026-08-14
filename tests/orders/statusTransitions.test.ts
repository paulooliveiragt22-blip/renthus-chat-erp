import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Espelha a allowlist da RPC (teste de contrato sem DB). */
function isAllowedTransition(
    from: string,
    to: string,
    fulfillmentType: "delivery" | "pickup"
): boolean {
    if (from === to) return true;
    if (fulfillmentType === "pickup" && to === "delivered") return false;
    if (from === "new" && ["preparing", "delivered", "finalized", "canceled"].includes(to)) {
        return true;
    }
    if (from === "preparing" && ["delivered", "finalized", "canceled"].includes(to)) {
        return true;
    }
    if (from === "delivered" && to === "finalized") return true;
    return false;
}

describe("order status transitions (M5)", () => {
    it("new → preparing / delivered / finalized / canceled", () => {
        for (const to of ["preparing", "delivered", "finalized", "canceled"]) {
            assert.equal(isAllowedTransition("new", to, "delivery"), true);
        }
    });

    it("preparing → delivered|finalized|canceled", () => {
        assert.equal(isAllowedTransition("preparing", "delivered", "delivery"), true);
        assert.equal(isAllowedTransition("preparing", "finalized", "delivery"), true);
        assert.equal(isAllowedTransition("preparing", "canceled", "delivery"), true);
        assert.equal(isAllowedTransition("preparing", "new", "delivery"), false);
    });

    it("pickup não vai para delivered", () => {
        assert.equal(isAllowedTransition("new", "delivered", "pickup"), false);
        assert.equal(isAllowedTransition("preparing", "delivered", "pickup"), false);
        assert.equal(isAllowedTransition("preparing", "finalized", "pickup"), true);
    });

    it("delivered só finaliza; finalized não reabre", () => {
        assert.equal(isAllowedTransition("delivered", "finalized", "delivery"), true);
        assert.equal(isAllowedTransition("delivered", "preparing", "delivery"), false);
        assert.equal(isAllowedTransition("finalized", "new", "delivery"), false);
    });
});
