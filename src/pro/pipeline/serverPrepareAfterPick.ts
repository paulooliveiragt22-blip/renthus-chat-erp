import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft, PrepareDraftToolInput, ProSessionState } from "@/src/types/contracts";
import {
    prepareOrderDraftFromTool,
    type PrepareOrderDraftCatalogPolicy,
} from "@/lib/chatbot/pro/prepareOrderDraft";
import {
    mergePreparedDraftIntoCurrent,
    removeDraftItemsMatchingName,
    unionAllowlistWithDraftIds,
} from "./mergeOrderDraft";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";
import { inferPaymentMethodFromText } from "./inferPaymentFromText";

/**
 * Prepare determinístico após pick de embalagem (botão / "opção N").
 * Evita 1–2 rodadas de LLM só para acrescentar um SKU já escolhido.
 */
export async function serverPrepareAfterProductPick(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
    /** Embalagem escolhida (primeiro id da allowlist pós-pick). */
    pickedEmbalagemId: string;
    /** Texto recente do cliente (para herdar PIX se draft ainda sem pagamento). */
    recentUserText?: string | null;
}): Promise<{
    state: ProSessionState;
    /** Draft ficou completo o bastante para ir ao resumo sem IA. */
    skipAi: boolean;
    preparedOk: boolean;
}> {
    const { admin, companyId, customerId, pickedEmbalagemId, recentUserText } = params;
    const embId = pickedEmbalagemId.trim();
    if (!embId) {
        return { state: params.state, skipAi: false, preparedOk: false };
    }

    /** Troca: remove linhas do nome pendente antes de acrescentar o SKU novo. */
    let state = params.state;
    const swapHint = state.pendingSwapRemoveName?.trim();
    if (swapHint) {
        const stripped = removeDraftItemsMatchingName(state.draft, swapHint);
        state = {
            ...state,
            draft: stripped,
            pendingSwapRemoveName: null,
        };
    }

    const byId = new Map<string, { produtoEmbalagemId: string; quantity: number }>();
    for (const it of state.draft?.items ?? []) {
        byId.set(it.produtoEmbalagemId, {
            produtoEmbalagemId: it.produtoEmbalagemId,
            quantity: it.quantity,
        });
    }
    const prev = byId.get(embId);
    byId.set(embId, { produtoEmbalagemId: embId, quantity: prev?.quantity ?? 1 });

    const addr = state.draft?.address;
    const paymentMethod =
        state.draft?.paymentMethod ??
        state.inferredPaymentMethod ??
        inferPaymentMethodFromText(recentUserText ?? "") ??
        null;
    const toolInput: PrepareDraftToolInput = {
        items: [...byId.values()],
        address: addr
            ? {
                  logradouro: addr.logradouro,
                  numero: addr.numero,
                  bairro: addr.bairro,
                  complemento: addr.complemento,
                  apelido: addr.apelido,
                  cidade: addr.cidade,
                  estado: addr.estado,
                  cep: addr.cep,
              }
            : null,
        useSavedAddress: !addr,
        paymentMethod,
        changeFor: state.draft?.changeFor ?? null,
    };

    const catalogPolicy: PrepareOrderDraftCatalogPolicy = {
        kind: "search_allowlist",
        allowedEmbalagemIds: unionAllowlistWithDraftIds(
            state.searchProdutoEmbalagemIds ?? [],
            state.draft
        ),
    };

    const prepared = await prepareOrderDraftFromTool(
        admin,
        companyId,
        customerId,
        toolInput,
        catalogPolicy
    );
    const nextDraft: OrderDraft | null = mergePreparedDraftIntoCurrent(state.draft, prepared.draft);
    if (!nextDraft?.items?.length) {
        return { state, skipAi: false, preparedOk: prepared.ok };
    }

    const nextState: ProSessionState = {
        ...state,
        draft: nextDraft,
        checkoutEditHold: false,
        pendingSwapRemoveName: null,
        lastSearchPicks: [],
    };

    const skipAi = isDraftStructurallyCompleteForFinalize(nextDraft);
    return { state: nextState, skipAi, preparedOk: prepared.ok };
}

/** Extrai o id do pick (primeiro da allowlist pós-`applyPick`). */
export function resolvePickedEmbalagemId(state: ProSessionState): string | null {
    const id = state.searchProdutoEmbalagemIds?.[0]?.trim();
    return id || null;
}
