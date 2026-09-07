/**
 * Extract estruturado de linhas de pedido (1× por selo de mensagem) — ADR 0011 D4.
 */
export type OrderLineExtractRow = {
    rawTerm: string;
    quantity: number | null;
};

export type OrderLinesExtractResult = {
    lines: OrderLineExtractRow[];
};

export interface OrderLinesExtractPort {
    extract(userText: string): Promise<OrderLinesExtractResult>;
}
