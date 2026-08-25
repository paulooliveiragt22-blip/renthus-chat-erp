import type { SupabaseClient } from "@supabase/supabase-js";

export type RecognizeOrderSaleInput = {
    companyId: string;
    orderId: string;
    idempotencyKey?: string | null;
    dueDate?: string | null;
};

export type SettleBillInput = {
    companyId: string;
    billId: string;
    payAmount: number;
    paymentMethod: string;
    receivedAt?: string | null;
    idempotencyKey?: string | null;
};

export type PostOpexInput = {
    companyId: string;
    payload: Record<string, unknown>;
};

export type ReverseJournalInput = {
    companyId: string;
    journalId: string;
    reason: string;
    idempotencyKey?: string | null;
};

export type ReverseJournalLineInput = {
    code: string;
    dir: "debit" | "credit";
    amt: number;
};

export type ReverseJournalPartialInput = {
    companyId: string;
    journalId: string;
    reason?: string | null;
    lines: ReverseJournalLineInput[];
    idempotencyKey?: string | null;
};

export type PostCashMovementInput = {
    companyId: string;
    registerId: string;
    type: "sangria" | "suprimento";
    amount: number;
    reason: string | null;
    operatorName?: string | null;
    idempotencyKey: string;
};

export type ReverseOrderSaleInput = {
    companyId: string;
    orderId: string;
    reason?: string | null;
    idempotencyKey?: string;
    rejectConfirmation?: boolean;
};

export type ReverseOrderItemInput = {
    orderItemId: string;
    qty: number;
};

export type ReverseOrderOperationInput = {
    companyId: string;
    orderId: string;
    mode: "full" | "partial";
    items?: ReverseOrderItemInput[];
    includeDeliveryFee?: boolean;
    includeServiceFees?: boolean;
    reason?: string | null;
    idempotencyKey: string;
    rejectConfirmation?: boolean;
};

export type FinanceCommandPort = {
    recognizeOrderSale(admin: SupabaseClient, input: RecognizeOrderSaleInput): Promise<unknown>;
    settleBill(admin: SupabaseClient, input: SettleBillInput): Promise<unknown>;
    postOpex(admin: SupabaseClient, input: PostOpexInput): Promise<unknown>;
    reverseJournal(admin: SupabaseClient, input: ReverseJournalInput): Promise<unknown>;
    reverseJournalPartial(admin: SupabaseClient, input: ReverseJournalPartialInput): Promise<unknown>;
    postCashMovement(admin: SupabaseClient, input: PostCashMovementInput): Promise<unknown>;
    reverseOrderSale(admin: SupabaseClient, input: ReverseOrderSaleInput): Promise<unknown>;
    reverseOrderOperation(admin: SupabaseClient, input: ReverseOrderOperationInput): Promise<unknown>;
};
