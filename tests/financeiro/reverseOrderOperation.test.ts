import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("reverseOrderOperation", () => {
    it("adapter chama rpc_admin_reverse_order_operation com mode e items", async () => {
        const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
        const admin = {
            rpc: async (name: string, args: Record<string, unknown>) => {
                calls.push({ name, args });
                return {
                    data: {
                        ok: true,
                        mode: "partial",
                        order_id: "ord-1",
                        reversed_journal_ids: ["j1"],
                        restatement_journal_ids: ["j2"],
                        order_status: "finalized",
                        event_id: "e1",
                    },
                    error: null,
                };
            },
        };

        const { reverseOrderOperation } = await import(
            "@/src/financeiro/application/reverseOrderOperation"
        );

        const result = await reverseOrderOperation(admin as never, {
            companyId: "co-1",
            orderId: "ord-1",
            mode: "partial",
            items: [{ orderItemId: "oi-1", qty: 1 }],
            includeDeliveryFee: true,
            idempotencyKey: "order:ord-1:reverse:partial:test",
            reason: "teste",
        });

        assert.equal(calls.length, 1);
        assert.equal(calls[0].name, "rpc_admin_reverse_order_operation");
        assert.equal(calls[0].args.p_mode, "partial");
        assert.equal(calls[0].args.p_include_delivery_fee, true);
        assert.deepEqual(calls[0].args.p_items, [{ order_item_id: "oi-1", qty: 1 }]);
        assert.equal(result.ok, true);
        assert.equal(result.mode, "partial");
        assert.equal(result.event_id, "e1");
    });

    it("migration e API events existem", () => {
        const mig = readFileSync(
            join(process.cwd(), "supabase/migrations/20260825030000_order_reverse_operation.sql"),
            "utf8"
        );
        assert.match(mig, /rpc_admin_reverse_order_operation/);
        assert.match(mig, /order_events/);
        assert.match(mig, /fn_fin_restate_order_sale/);

        const eventsApi = readFileSync(
            join(process.cwd(), "app/api/admin/orders/[id]/events/route.ts"),
            "utf8"
        );
        assert.match(eventsApi, /order_events/);
        assert.match(eventsApi, /orders\.read/);
    });

    it("JournalEntryModal usa reverse-order e estorno completo", () => {
        const ui = readFileSync(
            join(process.cwd(), "app/(admin)/financeiro/components/JournalEntryModal.tsx"),
            "utf8"
        );
        assert.match(ui, /\/api\/admin\/financeiro\/reverse-order/);
        assert.match(ui, /Estornar pedido completo/);
        assert.match(ui, /confirmMode === "full"|mode: "full"|openConfirm\("full"\)/);
    });
});
