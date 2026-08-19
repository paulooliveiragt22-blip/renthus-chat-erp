/**
 * Estorno de venda/pedido — tipos estáveis para RPC e API.
 */

export type ReversalMode = "full" | "partial";

export type ReverseOrderLineInput = {
    orderItemId: string;
    qty: number;
};

export type ReverseOrderSaleInput = {
    companyId: string;
    orderId: string;
    mode: ReversalMode;
    reason: string;
    /** Fase D — linhas para estorno parcial */
    lines?: ReverseOrderLineInput[];
    idempotencyKey?: string;
};
