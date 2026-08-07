import type { OrderDraft, PrepareDraftToolInput } from "@/src/types/contracts";
import type { PrepareOrderDraftCatalogPolicy } from "@/src/pro/tools/prepareOrderDraft";

/**
 * Motivo único (prioritário) do bloqueio, com payload tipado — substitui o antigo
 * `next_required_slot` (string solta) como sinal estruturado de "o que falta".
 * `errors: string[]` continua existindo em `PrepareOrderDraftResult` só para o catálogo
 * dinâmico de mensagens por item (estoque, UUID inválido, etc.), que não vale a pena
 * enumerar em código — não é dual-path, são responsabilidades diferentes.
 */
export type PrepareOrderDraftBlockedReason =
    | { code: "MISSING_ITEMS" }
    | { code: "ADDRESS_INCOMPLETE" }
    | { code: "OUT_OF_DELIVERY_ZONE"; neighborhood: string }
    | { code: "BELOW_MIN_ORDER"; missing: number; minOrder: number }
    | { code: "PAYMENT_MISSING" }
    | { code: "INVALID_CHANGE_FOR"; grandTotal: number; changeFor: number }
    /** Erros dinâmicos de item/catálogo/estoque/cliente — ver `errors` para o detalhe. */
    | { code: "FIX_ERRORS" };

export type PrepareOrderDraftResult = {
    ok: boolean;
    draft: OrderDraft | null;
    errors: string[];
    /** `null` quando `ok: true`. */
    blocked: PrepareOrderDraftBlockedReason | null;
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
