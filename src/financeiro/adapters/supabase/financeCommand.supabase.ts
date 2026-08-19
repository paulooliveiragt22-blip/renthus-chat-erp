import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    FinanceCommandPort,
    PostCashMovementInput,
    PostOpexInput,
    RecognizeOrderSaleInput,
    ReverseJournalInput,
    ReverseOrderSaleInput,
    SettleBillInput,
} from "@/src/financeiro/ports/financeCommand.port";

async function rpcOrThrow(
    admin: SupabaseClient,
    name: string,
    args: Record<string, unknown>
): Promise<unknown> {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
}

export const financeCommandSupabase: FinanceCommandPort = {
    recognizeOrderSale(admin, input: RecognizeOrderSaleInput) {
        return rpcOrThrow(admin, "rpc_recognize_order_sale", {
            p_company_id: input.companyId,
            p_order_id: input.orderId,
            p_idempotency_key: input.idempotencyKey ?? `order:${input.orderId}:recognize`,
            p_due_date: input.dueDate ?? null,
        });
    },

    settleBill(admin, input: SettleBillInput) {
        return rpcOrThrow(admin, "rpc_settle_bill", {
            p_company_id: input.companyId,
            p_bill_id: input.billId,
            p_pay_amount: input.payAmount,
            p_payment_method: input.paymentMethod,
            p_received_at: input.receivedAt ?? null,
            p_idempotency_key: input.idempotencyKey ?? null,
        });
    },

    postOpex(admin, input: PostOpexInput) {
        return rpcOrThrow(admin, "rpc_post_opex", {
            p_company_id: input.companyId,
            p_payload: input.payload,
        });
    },

    reverseJournal(admin, input: ReverseJournalInput) {
        return rpcOrThrow(admin, "rpc_reverse_journal", {
            p_company_id: input.companyId,
            p_journal_id: input.journalId,
            p_reason: input.reason,
            p_idempotency_key: input.idempotencyKey ?? null,
        });
    },

    postCashMovement(admin, input: PostCashMovementInput) {
        return rpcOrThrow(admin, "rpc_post_cash_movement", {
            p_company_id: input.companyId,
            p_register_id: input.registerId,
            p_type: input.type,
            p_amount: input.amount,
            p_reason: input.reason,
            p_operator_name: input.operatorName ?? null,
            p_idempotency_key: input.idempotencyKey,
        });
    },

    reverseOrderSale(admin, input: ReverseOrderSaleInput) {
        return rpcOrThrow(admin, "rpc_admin_cancel_order", {
            p_company_id: input.companyId,
            p_order_id: input.orderId,
            p_reject_confirmation: input.rejectConfirmation ?? false,
        });
    },
};
