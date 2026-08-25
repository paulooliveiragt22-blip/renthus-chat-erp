import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    FinanceCommandPort,
    PostCashMovementInput,
    PostOpexInput,
    RecognizeOrderSaleInput,
    ReverseJournalInput,
    ReverseJournalPartialInput,
    ReverseOrderOperationInput,
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

    reverseJournalPartial(admin, input: ReverseJournalPartialInput) {
        return rpcOrThrow(admin, "rpc_reverse_journal_partial", {
            p_company_id: input.companyId,
            p_journal_id: input.journalId,
            p_reason: input.reason ?? "",
            p_lines: input.lines,
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
        const orderId = input.orderId;
        const idempotencyKey =
            input.idempotencyKey?.trim() ||
            `order:${orderId}:reverse:cancel`;
        return rpcOrThrow(admin, "rpc_admin_reverse_order_operation", {
            p_company_id: input.companyId,
            p_order_id: orderId,
            p_mode: "full",
            p_items: null,
            p_include_delivery_fee: false,
            p_include_service_fees: false,
            p_reason: input.reason ?? "",
            p_idempotency_key: idempotencyKey,
            p_reject_confirmation: input.rejectConfirmation ?? false,
        });
    },

    reverseOrderOperation(admin, input: ReverseOrderOperationInput) {
        const items =
            input.items?.map((it) => ({
                order_item_id: it.orderItemId,
                qty: it.qty,
            })) ?? null;
        return rpcOrThrow(admin, "rpc_admin_reverse_order_operation", {
            p_company_id: input.companyId,
            p_order_id: input.orderId,
            p_mode: input.mode,
            p_items: items,
            p_include_delivery_fee: input.includeDeliveryFee ?? false,
            p_include_service_fees: input.includeServiceFees ?? false,
            p_reason: input.reason ?? "",
            p_idempotency_key: input.idempotencyKey,
            p_reject_confirmation: input.rejectConfirmation ?? false,
        });
    },
};
