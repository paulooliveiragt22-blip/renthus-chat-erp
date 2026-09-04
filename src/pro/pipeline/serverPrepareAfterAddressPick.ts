import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, PrepareDraftToolInput, ProSessionState } from "@/src/types/contracts";
import {
    prepareOrderDraftFromTool,
    type PrepareOrderDraftCatalogPolicy,
} from "@/src/pro/tools/prepareOrderDraft";
import { mergePreparedDraftIntoCurrent, unionAllowlistWithDraftIds } from "./mergeOrderDraft";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";
import { isAddressStructurallyComplete } from "./orderSlotStep";

/** Prefixo do botão de escolha de endereço (mais usado vs. do pedido mais recente). */
export const PICK_ADDRESS_PREFIX = "pro_pick_address:";

/** Extrai o `enderecos_cliente.id` do botão `pro_pick_address:<id>`, se for esse o inbound. */
export function parseAddressPickButtonId(text: string): string | null {
    const raw = text.trim();
    if (!raw.toLowerCase().startsWith(PICK_ADDRESS_PREFIX)) return null;
    const id = raw.slice(PICK_ADDRESS_PREFIX.length).trim();
    return id || null;
}

/**
 * Botão de escolha de endereço (toque = decisão explícita do cliente): aplica `saved_address_id`
 * direto via `prepare_order_draft` no servidor, sem rodada de IA — recalcula taxa/zona/mínimo
 * de entrega para o endereço escolhido, igual ao fluxo determinístico de pick de produto.
 */
export async function serverPrepareAfterAddressPick(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
    enderecoClienteId: string;
}): Promise<{
    state: ProSessionState;
    /** Draft ficou completo (ou só falta pagamento): não precisa rodada de IA. */
    skipAi: boolean;
    preparedOk: boolean;
    outbound: OutboundMessage[];
}> {
    const { admin, companyId, customerId, state, enderecoClienteId } = params;
    const draft = state.draft;
    if (!draft?.items?.length) {
        return { state, skipAi: false, preparedOk: false, outbound: [] };
    }

    const toolInput: PrepareDraftToolInput = {
        items: draft.items.map((i) => ({
            produtoEmbalagemId: i.produtoEmbalagemId,
            quantity: i.quantity,
        })),
        address: null,
        savedAddressId: enderecoClienteId,
        useSavedAddress: false,
        paymentMethod: draft.paymentMethod,
        changeFor: draft.paymentMethod === "cash" ? draft.changeFor ?? null : null,
    };

    const catalogPolicy: PrepareOrderDraftCatalogPolicy = {
        kind: "search_allowlist",
        allowedEmbalagemIds: unionAllowlistWithDraftIds(state.searchProdutoEmbalagemIds ?? [], draft),
    };

    const prepared = await prepareOrderDraftFromTool(admin, companyId, customerId, toolInput, catalogPolicy);

    if (!prepared.draft?.address) {
        return {
            state,
            skipAi: false,
            preparedOk: false,
            outbound: [
                {
                    kind: "text",
                    text: prepared.errors[0]
                        ? `Não consegui usar esse endereço: ${prepared.errors[0]}`
                        : "Não consegui usar esse endereço. Pode enviar outro, por favor?",
                },
            ],
        };
    }

    const nextDraft = mergePreparedDraftIntoCurrent(draft, prepared.draft);
    const nextState: ProSessionState = {
        ...state,
        draft: nextDraft,
        deliveryAddressUiConfirmed: true,
        checkoutEditHold: false,
        pendingAddressPickOptions: [],
        proposedAddressId: null,
    };

    const readyForPaymentUi =
        Boolean(nextDraft?.items?.length) &&
        isAddressStructurallyComplete(nextDraft?.address ?? null) &&
        !nextDraft?.paymentMethod;
    const skipAi = isDraftStructurallyCompleteForFinalize(nextDraft!) || readyForPaymentUi;

    return { state: nextState, skipAi, preparedOk: prepared.ok, outbound: [] };
}
