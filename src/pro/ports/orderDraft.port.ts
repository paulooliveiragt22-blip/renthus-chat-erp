import type { OrderDraft, PrepareDraftToolInput } from "@/src/types/contracts";
import type { PrepareOrderDraftCatalogPolicy } from "@/src/pro/tools/prepareOrderDraft";

export type PrepareOrderDraftResult = {
    ok: boolean;
    draft: OrderDraft | null;
    errors: string[];
    next_required_slot?: "items" | "address" | "payment" | "fix_errors" | null;
};

/**
 * Porta de validação/montagem de rascunho (não cria pedido em `orders`).
 */
export interface OrderDraftPort {
    prepareFromToolInput(params: {
        companyId: string;
        customerId: string | null;
        body: PrepareDraftToolInput;
        catalogPolicy?: PrepareOrderDraftCatalogPolicy;
    }): Promise<PrepareOrderDraftResult>;
}
