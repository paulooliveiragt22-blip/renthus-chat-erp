import type { SupabaseClient } from "@supabase/supabase-js";
import { financeCommandSupabase } from "@/src/financeiro/adapters/supabase/financeCommand.supabase";
import type {
    ReverseOrderOperationInput,
    ReverseOrderOperationResult,
} from "@/src/financeiro/domain/reversal";

export async function reverseOrderOperation(
    admin: SupabaseClient,
    input: ReverseOrderOperationInput
): Promise<ReverseOrderOperationResult> {
    const raw = await financeCommandSupabase.reverseOrderOperation(admin, input);
    const data = (raw ?? {}) as Record<string, unknown>;
    return {
        ok: Boolean(data.ok),
        mode: (data.mode as ReverseOrderOperationResult["mode"]) ?? input.mode,
        order_id: String(data.order_id ?? input.orderId),
        reversed_journal_ids: Array.isArray(data.reversed_journal_ids)
            ? (data.reversed_journal_ids as string[])
            : [],
        restatement_journal_ids: Array.isArray(data.restatement_journal_ids)
            ? (data.restatement_journal_ids as string[])
            : [],
        order_status: String(data.order_status ?? ""),
        event_id: String(data.event_id ?? ""),
        idempotent: data.idempotent === true,
    };
}
