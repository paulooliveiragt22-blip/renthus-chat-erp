import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

/** Regras de UI alinhadas a PedidosClient.canCancel */
function canCancelOrder(status: string): boolean {
    const s = String(status).trim().toLowerCase();
    return s !== "canceled" && s !== "delivered";
}

describe("reverseOrderSale contract", () => {
    it("canCancel permite finalized (estorno full) mas não delivered", () => {
        assert.equal(canCancelOrder("new"), true);
        assert.equal(canCancelOrder("preparing"), true);
        assert.equal(canCancelOrder("finalized"), true);
        assert.equal(canCancelOrder("delivered"), false);
        assert.equal(canCancelOrder("canceled"), false);
    });

    it("reverseOrderSale chama rpc_admin_reverse_order_operation (full) e persiste reason", async () => {
        const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
        const updates: Array<Record<string, unknown>> = [];

        const admin = {
            rpc: async (name: string, args: Record<string, unknown>) => {
                rpcCalls.push({ name, args });
                return { data: { ok: true, mode: "full" }, error: null };
            },
            from: (table: string) => {
                assert.equal(table, "orders");
                return {
                    update: (patch: Record<string, unknown>) => ({
                        eq: (_col: string, _val: string) => ({
                            eq: async (_col2: string, _val2: string) => {
                                updates.push(patch);
                                return { error: null };
                            },
                        }),
                    }),
                };
            },
        };

        const { reverseOrderSale } = await import(
            "@/src/financeiro/application/reverseOrderSale"
        );

        await reverseOrderSale(admin as never, {
            companyId: "co-1",
            orderId: "ord-1",
            reason: "Cliente desistiu",
            idempotencyKey: "order:ord-1:reverse:cancel",
        });

        assert.equal(rpcCalls.length, 1);
        assert.equal(rpcCalls[0].name, "rpc_admin_reverse_order_operation");
        assert.equal(rpcCalls[0].args.p_mode, "full");
        assert.equal(rpcCalls[0].args.p_order_id, "ord-1");
        assert.equal(rpcCalls[0].args.p_idempotency_key, "order:ord-1:reverse:cancel");
        assert.deepEqual(updates[0], { details: "Cliente desistiu" });
    });

    it("reverseOrderSale sem reason não atualiza orders", async () => {
        let updateCalled = false;
        const admin = {
            rpc: async () => ({ data: { ok: true }, error: null }),
            from: () => ({
                update: () => ({
                    eq: () => ({
                        eq: async () => {
                            updateCalled = true;
                            return { error: null };
                        },
                    }),
                }),
            }),
        };

        const { reverseOrderSale } = await import(
            "@/src/financeiro/application/reverseOrderSale"
        );

        await reverseOrderSale(admin as never, {
            companyId: "co-1",
            orderId: "ord-1",
        });

        assert.equal(updateCalled, false);
    });

    it("financeCommand.reverseOrderSale mapeia reject_confirmation", async () => {
        const rpc = mock.fn(async (_name: string, args: Record<string, unknown>) => {
            assert.equal(args.p_reject_confirmation, true);
            assert.equal(args.p_mode, "full");
            return { data: { ok: true }, error: null };
        });

        const admin = { rpc };

        const { financeCommandSupabase } = await import(
            "@/src/financeiro/adapters/supabase/financeCommand.supabase"
        );

        await financeCommandSupabase.reverseOrderSale(admin as never, {
            companyId: "c",
            orderId: "o",
            rejectConfirmation: true,
        });

        assert.equal(rpc.mock.callCount(), 1);
        assert.equal(rpc.mock.calls[0].arguments[0], "rpc_admin_reverse_order_operation");
    });
});
