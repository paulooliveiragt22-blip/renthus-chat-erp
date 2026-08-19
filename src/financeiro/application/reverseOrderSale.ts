import type { SupabaseClient } from "@supabase/supabase-js";
import { financeCommandSupabase } from "@/src/financeiro/adapters/supabase/financeCommand.supabase";
import type { ReverseOrderSaleInput } from "@/src/financeiro/ports/financeCommand.port";

/**
 * Estorno full de pedido: journals revertidos + bills cancelados + DELETE order_items (estoque).
 */
export async function reverseOrderSale(
    admin: SupabaseClient,
    input: ReverseOrderSaleInput
): Promise<void> {
    await financeCommandSupabase.reverseOrderSale(admin, input);

    const reason = String(input.reason ?? "").trim();
    if (!reason) return;

    const { error } = await admin
        .from("orders")
        .update({ details: reason })
        .eq("id", input.orderId)
        .eq("company_id", input.companyId);
    if (error) throw new Error(error.message);
}
