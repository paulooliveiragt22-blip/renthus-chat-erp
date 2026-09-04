import assert from "node:assert/strict";
import { describe, it } from "node:test";

/** Espelha o mapeamento de status da RPC no fulfillPayment. */
function mapRpcFulfillStatus(row: {
    status?: string;
    kind?: string;
}): { kind: "setup" | "invoice"; alreadyDone?: boolean } | "not_found" | "bad" {
    const status = String(row.status ?? "");
    if (status === "not_found") return "not_found";
    const kind = row.kind === "setup" ? ("setup" as const) : ("invoice" as const);
    if (status === "already_done") return { kind, alreadyDone: true };
    if (status === "fulfilled") return { kind };
    return "bad";
}

describe("mapRpcFulfillStatus (EX3)", () => {
    it("not_found", () => {
        assert.equal(mapRpcFulfillStatus({ status: "not_found" }), "not_found");
    });

    it("already_done setup", () => {
        assert.deepEqual(mapRpcFulfillStatus({ status: "already_done", kind: "setup" }), {
            kind: "setup",
            alreadyDone: true,
        });
    });

    it("fulfilled invoice", () => {
        assert.deepEqual(mapRpcFulfillStatus({ status: "fulfilled", kind: "invoice" }), {
            kind: "invoice",
        });
    });

    it("status desconhecido", () => {
        assert.equal(mapRpcFulfillStatus({ status: "weird" }), "bad");
    });
});
