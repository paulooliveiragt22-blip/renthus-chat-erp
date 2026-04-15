import type { OrderServiceInput, OrderServiceResult } from "@/src/types/contracts";

export interface OrderService {
    createFromDraft(input: OrderServiceInput): Promise<OrderServiceResult>;
}

