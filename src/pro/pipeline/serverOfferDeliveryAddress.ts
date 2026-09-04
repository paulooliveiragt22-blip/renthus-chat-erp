/**
 * Após quick action Entrega: carrega endereços salvos, propõe o último usado no draft
 * (ainda sem UI confirm) e devolve a oferta Confirmar / Novo / índice.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, PrepareDraftToolInput, ProSessionState } from "@/src/types/contracts";
import {
    prepareOrderDraftFromTool,
    type PrepareOrderDraftCatalogPolicy,
} from "@/src/pro/tools/prepareOrderDraft";
import { mergePreparedDraftIntoCurrent, unionAllowlistWithDraftIds } from "./mergeOrderDraft";
import { rankCustomerAddressesByDelivery } from "@/src/pro/tools/resolveSavedAddress";
import {
    buildDeliveryAddressOfferOutbound,
    buildPendingAddressPickOptions,
    listCompleteSavedAddresses,
    pickProposedDeliveryAddress,
} from "./deliveryAddressOffer";
import { isAddressStructurallyComplete } from "./orderDraftGate";

export async function serverOfferDeliveryAddressAfterFulfillment(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
}): Promise<{
    state: ProSessionState;
    outbound: OutboundMessage[];
    offered: boolean;
}> {
    const { admin, companyId, customerId, state } = params;
    const draft = state.draft;
    if (!draft?.items?.length || !customerId) {
        return {
            state,
            outbound: [
                {
                    kind: "text",
                    text: "Combinado: entrega. Me envia o endereço: rua, número, bairro, cidade e UF.",
                },
            ],
            offered: false,
        };
    }

    const stats = await rankCustomerAddressesByDelivery(admin, companyId, customerId);
    const complete = listCompleteSavedAddresses(stats);
    const proposed = pickProposedDeliveryAddress(stats, complete);

    if (!proposed) {
        return {
            state: {
                ...state,
                pendingAddressPickOptions: [],
                proposedAddressId: null,
                deliveryAddressUiConfirmed: false,
            },
            outbound: [
                {
                    kind: "text",
                    text: "Combinado: entrega. Me envia o endereço: rua, número, bairro, cidade e UF.",
                },
            ],
            offered: false,
        };
    }

    const toolInput: PrepareDraftToolInput = {
        items: draft.items.map((i) => ({
            produtoEmbalagemId: i.produtoEmbalagemId,
            quantity: i.quantity,
        })),
        address: null,
        savedAddressId: proposed.id,
        useSavedAddress: false,
        paymentMethod: draft.paymentMethod,
        changeFor: draft.paymentMethod === "cash" ? draft.changeFor ?? null : null,
    };
    const catalogPolicy: PrepareOrderDraftCatalogPolicy = {
        kind: "search_allowlist",
        allowedEmbalagemIds: unionAllowlistWithDraftIds(state.searchProdutoEmbalagemIds ?? [], draft),
    };
    const prepared = await prepareOrderDraftFromTool(
        admin,
        companyId,
        customerId,
        toolInput,
        catalogPolicy
    );

    const nextDraft = prepared.draft
        ? mergePreparedDraftIntoCurrent(draft, {
              ...prepared.draft,
              fulfillmentType: "delivery",
          })
        : { ...draft, fulfillmentType: "delivery" as const };

    /** Sem endereço estrutural no draft, a oferta Confirmar não fecha o slot — cai no texto livre. */
    if (!nextDraft || !isAddressStructurallyComplete(nextDraft.address)) {
        return {
            state: {
                ...state,
                draft: { ...draft, fulfillmentType: "delivery" },
                pendingAddressPickOptions: [],
                proposedAddressId: null,
                deliveryAddressUiConfirmed: false,
            },
            outbound: [
                {
                    kind: "text",
                    text: "Combinado: entrega. Me envia o endereço: rua, número, bairro, cidade e UF.",
                },
            ],
            offered: false,
        };
    }

    const others = complete.filter((a) => a.id !== proposed.id);
    const pendingOptions = buildPendingAddressPickOptions(others);

    const nextState: ProSessionState = {
        ...state,
        draft: nextDraft,
        proposedAddressId: proposed.id,
        pendingAddressPickOptions: pendingOptions,
        /** Oferta explícita — não auto-confirmar só porque o draft já tem rua/número. */
        deliveryAddressUiConfirmed: false,
        checkoutEditHold: false,
    };

    return {
        state: nextState,
        outbound: buildDeliveryAddressOfferOutbound({ proposed, others }),
        offered: true,
    };
}
