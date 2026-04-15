/**
 * Rascunho canónico de pedido IA (servidor é fonte de verdade para preços/stock).
 * Persistido em `chatbot_sessions.context.ai_order_canonical`.
 *
 * Tipos importados de `src/types/contracts.ts` para manter contrato único.
 */

export type {
    AiOrderAddressLegacy as AiOrderAddress,
    AiOrderItemLegacy as AiOrderItem,
    AiOrderCanonicalDraftLegacy as AiOrderCanonicalDraft,
} from "@/src/types/contracts.legacy";
