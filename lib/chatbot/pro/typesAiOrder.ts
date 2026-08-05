/**
 * Aliases do contrato snake_case usado por `prepareOrderDraft` / tools.
 * Estado PRO na sessão: `context.__pro_v2_state` (não `ai_order_canonical`).
 */

export type {
    AiOrderAddressLegacy as AiOrderAddress,
    AiOrderItemLegacy as AiOrderItem,
    AiOrderCanonicalDraftLegacy as AiOrderCanonicalDraft,
} from "@/src/types/contracts.legacy";
