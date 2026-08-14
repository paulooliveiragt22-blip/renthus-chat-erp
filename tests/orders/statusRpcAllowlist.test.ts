/**
 * Espelha allowlist de `rpc_set_order_status` (migration M5).
 * Garante que violações de transição / pickup→delivered são rejeitadas no domínio.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

type Status = "new" | "preparing" | "delivered" | "finalized" | "canceled";

/** Mesma regra da RPC (exceto cancel preferencial via rpc_admin_cancel_order). */
function rpcAllowsTransition(
    from: Status,
    to: Status,
    fulfillmentType: "delivery" | "pickup"
): { ok: true } | { ok: false; error: string } {
    if (from === to) return { ok: true };
    const allowed =
        (from === "new" && ["preparing", "delivered", "finalized", "canceled"].includes(to)) ||
        (from === "preparing" && ["delivered", "finalized", "canceled"].includes(to)) ||
        (from === "delivered" && to === "finalized");
    if (!allowed) {
        return { ok: false, error: `transição de status não permitida: ${from} → ${to}` };
    }
    if (fulfillmentType === "pickup" && to === "delivered") {
        return { ok: false, error: "pedido de retirada não pode ir para em entrega" };
    }
    return { ok: true };
}

describe("rpc_set_order_status allowlist (M5 falhas)", () => {
    it("caminho feliz: new → preparing", () => {
        assert.deepEqual(rpcAllowsTransition("new", "preparing", "delivery"), { ok: true });
        assert.deepEqual(rpcAllowsTransition("new", "preparing", "pickup"), { ok: true });
    });

    it("rejeita preparing → new (constraint/allowlist)", () => {
        const r = rpcAllowsTransition("preparing", "new", "delivery");
        assert.equal(r.ok, false);
        if (!r.ok) assert.match(r.error, /não permitida/);
    });

    it("rejeita finalized → preparing", () => {
        assert.equal(rpcAllowsTransition("finalized", "preparing", "delivery").ok, false);
    });

    it("rejeita canceled → qualquer", () => {
        for (const to of ["new", "preparing", "delivered", "finalized"] as Status[]) {
            assert.equal(rpcAllowsTransition("canceled", to, "delivery").ok, false);
        }
    });

    it("pickup não pode ir para delivered (check de negócio)", () => {
        const r = rpcAllowsTransition("preparing", "delivered", "pickup");
        assert.equal(r.ok, false);
        if (!r.ok) assert.match(r.error, /retirada/);
    });

    it("delivery pode preparing → delivered → finalized", () => {
        assert.equal(rpcAllowsTransition("preparing", "delivered", "delivery").ok, true);
        assert.equal(rpcAllowsTransition("delivered", "finalized", "delivery").ok, true);
    });

    it("pickup: preparing → finalized ok", () => {
        assert.equal(rpcAllowsTransition("preparing", "finalized", "pickup").ok, true);
    });
});
