/**
 * Estorno de venda/pedido — tipos estáveis para RPC e API.
 */

export type ReversalMode = "full" | "partial";

export type ReverseOrderItemInput = {
    orderItemId: string;
    qty: number;
};

export type ReverseOrderOperationInput = {
    companyId: string;
    orderId: string;
    mode: ReversalMode;
    items?: ReverseOrderItemInput[];
    includeDeliveryFee?: boolean;
    includeServiceFees?: boolean;
    reason?: string | null;
    idempotencyKey: string;
    rejectConfirmation?: boolean;
};

export type ReverseOrderOperationResult = {
    ok: boolean;
    mode: ReversalMode;
    order_id: string;
    reversed_journal_ids: string[];
    restatement_journal_ids: string[];
    order_status: string;
    event_id: string;
    idempotent?: boolean;
};

/** @deprecated use ReverseOrderOperationInput with mode=full */
export type ReverseOrderLineInput = {
    orderItemId: string;
    qty: number;
};

export type ReverseOrderSaleInput = {
    companyId: string;
    orderId: string;
    reason?: string | null;
    idempotencyKey?: string;
    rejectConfirmation?: boolean;
};
