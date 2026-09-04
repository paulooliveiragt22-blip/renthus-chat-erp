import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    isOrderCreditPaid,
    isPagarmeOrderTerminalFailed,
    type PagarmeOrder,
} from "@/lib/billing/pagarme";

function order(partial: {
    status?: string;
    chargeStatus?: string;
}): PagarmeOrder {
    return {
        id: "or_1",
        status: partial.status ?? "pending",
        charges: partial.chargeStatus
            ? [{ id: "ch_1", status: partial.chargeStatus }]
            : [],
    } as PagarmeOrder;
}

describe("isPagarmeOrderTerminalFailed", () => {
    it("false se paid (order ou charge)", () => {
        assert.equal(isPagarmeOrderTerminalFailed(order({ status: "paid" })), false);
        assert.equal(
            isPagarmeOrderTerminalFailed(order({ status: "pending", chargeStatus: "paid" })),
            false
        );
        assert.equal(isOrderCreditPaid(order({ status: "paid" })), true);
    });

    it("true para failed/canceled no order", () => {
        assert.equal(isPagarmeOrderTerminalFailed(order({ status: "failed" })), true);
        assert.equal(isPagarmeOrderTerminalFailed(order({ status: "canceled" })), true);
        assert.equal(isPagarmeOrderTerminalFailed(order({ status: "cancelled" })), true);
    });

    it("true para failed na charge", () => {
        assert.equal(
            isPagarmeOrderTerminalFailed(
                order({ status: "pending", chargeStatus: "failed" })
            ),
            true
        );
        assert.equal(
            isPagarmeOrderTerminalFailed(
                order({ status: "pending", chargeStatus: "not_authorized" })
            ),
            true
        );
    });

    it("false enquanto pending/processing", () => {
        assert.equal(isPagarmeOrderTerminalFailed(order({ status: "pending" })), false);
        assert.equal(
            isPagarmeOrderTerminalFailed(
                order({ status: "pending", chargeStatus: "processing" })
            ),
            false
        );
    });
});
