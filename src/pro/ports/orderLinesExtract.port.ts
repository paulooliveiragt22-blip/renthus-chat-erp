import type { FulfillmentType } from "@/src/types/contracts";

/**
 * Extract estruturado de linhas de pedido (1× por selo de mensagem) — ADR 0011 D4.
 * `fulfillment` é a modalidade dita na frase, fora da lista de produtos.
 */
export type OrderLineExtractRow = {
    rawTerm: string;
    quantity: number | null;
};

export type OrderLinesExtractResult = {
    lines: OrderLineExtractRow[];
    /** Ausente no mock antigo = null. */
    fulfillment?: FulfillmentType | null;
};

export function normalizeExtractedFulfillment(value: unknown): FulfillmentType | null {
    return value === "delivery" || value === "pickup" ? value : null;
}

export interface OrderLinesExtractPort {
    extract(userText: string): Promise<OrderLinesExtractResult>;
}
