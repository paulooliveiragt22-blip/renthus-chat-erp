import type { SupabaseClient } from "@supabase/supabase-js";
import { reverseOrderOperation } from "@/src/financeiro/application/reverseOrderOperation";
import type { ReverseOrderSaleInput } from "@/src/financeiro/ports/financeCommand.port";

/**
 * Estorno full de pedido: journals revertidos + bills cancelados + DELETE order_items (estoque).
 */
export async function reverseOrderSale(
    admin: SupabaseClient,
    input: ReverseOrderSaleInput
): Promise<void> {
    const orderId = input.orderId;
    const idempotencyKey =
        input.idempotencyKey?.trim() || `order:${orderId}:reverse:cancel`;

    await reverseOrderOperation(admin, {
        companyId: input.companyId,
        orderId,
        mode: "full",
        reason: input.reason ?? null,
        idempotencyKey,
        rejectConfirmation: input.rejectConfirmation ?? false,
    });

    const reason = String(input.reason ?? "").trim();
    if (!reason) return;

    const { error } = await admin
        .from("orders")
        .update({ details: reason })
        .eq("id", orderId)
        .eq("company_id", input.companyId);
    if (error) throw new Error(error.message);
}
