import type { SupabaseClient } from "@supabase/supabase-js";
import type {
    OrderDraft,
    OutboundMessage,
    PrepareDraftToolInput,
    ProSessionState,
} from "@/src/types/contracts";
import {
    prepareOrderDraftFromTool,
    type PrepareOrderDraftCatalogPolicy,
} from "@/lib/chatbot/pro/prepareOrderDraft";
import {
    mergePreparedDraftIntoCurrent,
    removeDraftItemsMatchingName,
    removeDraftItemsMatchingNameExcept,
    unionAllowlistWithDraftIds,
} from "./mergeOrderDraft";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";
import { inferPaymentMethodFromText } from "./inferPaymentFromText";
import {
    dequeueBootstrapClarification,
    hasPendingBootstrapClarifications,
} from "./bootstrapClarifyQueue";

/**
 * Prepare determinístico após pick de embalagem (botão / "opção N").
 * Evita 1–2 rodadas de LLM só para acrescentar um SKU já escolhido.
 * Se ainda houver clarificações do bootstrap, devolve o próximo card em vez do resumo.
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
    /** Próxima clarificação multi-item (se houver). */
    clarificationOutbound: OutboundMessage[];
}> {
    const { admin, companyId, customerId, pickedEmbalagemId, recentUserText } = params;
    const embId = pickedEmbalagemId.trim();
    if (!embId) {
        return {
            state: params.state,
            skipAi: false,
            preparedOk: false,
            clarificationOutbound: [],
        };
    }

    /** Troca: remove linhas do nome pendente antes de acrescentar o SKU novo. */
    let state = params.state;
    const swapHint = state.pendingSwapRemoveName?.trim() || null;
    if (swapHint) {
        const beforeIds = new Set(
            (state.draft?.items ?? []).map((i) => i.produtoEmbalagemId).filter(Boolean)
        );
        const stripped = removeDraftItemsMatchingName(state.draft, swapHint);
        const afterIds = new Set(
            (stripped?.items ?? []).map((i) => i.produtoEmbalagemId).filter(Boolean)
        );
        const removedIds = [...beforeIds].filter((id) => !afterIds.has(id));
        const reject = new Set(removedIds);
        state = {
            ...state,
            draft: stripped,
            pendingSwapRemoveName: null,
            /** Evita prepare reancorar o UN removido via bootstrapResolved. */
            bootstrapResolvedEmbalagemIds: (state.bootstrapResolvedEmbalagemIds ?? []).filter(
                (id) => id && !reject.has(id)
            ),
        };
    }

    const byId = new Map<string, { produtoEmbalagemId: string; quantity: number }>();
    for (const it of state.draft?.items ?? []) {
        byId.set(it.produtoEmbalagemId, {
            produtoEmbalagemId: it.produtoEmbalagemId,
            quantity: it.quantity,
        });
    }
    /** Bootstrap: reancora SKUs resolvidos antes da clarificação (boot já limpo no swap/reject). */
    for (const id of state.bootstrapResolvedEmbalagemIds ?? []) {
        const sid = String(id ?? "").trim();
        if (!sid || byId.has(sid)) continue;
        byId.set(sid, { produtoEmbalagemId: sid, quantity: 1 });
    }
    const prev = byId.get(embId);
    byId.set(embId, { produtoEmbalagemId: embId, quantity: prev?.quantity ?? 1 });

    const resolvedIds = [
        ...new Set([...(state.bootstrapResolvedEmbalagemIds ?? []), embId]),
    ];

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
            [
                ...(state.searchProdutoEmbalagemIds ?? []),
                ...resolvedIds,
                embId,
            ],
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
    let nextDraft: OrderDraft | null = mergePreparedDraftIntoCurrent(state.draft, prepared.draft);
    if (swapHint && nextDraft) {
        nextDraft = removeDraftItemsMatchingNameExcept(nextDraft, swapHint, [embId]);
    }
    if (!nextDraft?.items?.length) {
        return {
            state: { ...state, bootstrapResolvedEmbalagemIds: resolvedIds },
            skipAi: false,
            preparedOk: prepared.ok,
            clarificationOutbound: [],
        };
    }

    const keptIds = new Set(nextDraft.items.map((i) => i.produtoEmbalagemId).filter(Boolean));
    const nextBoot = resolvedIds.filter((id) => keptIds.has(id) || id === embId);

    let nextState: ProSessionState = {
        ...state,
        draft: nextDraft,
        bootstrapResolvedEmbalagemIds: nextBoot,
        checkoutEditHold: false,
        pendingSwapRemoveName: null,
        lastSearchPicks: [],
    };

    if (hasPendingBootstrapClarifications(nextState)) {
        const nextClarify = dequeueBootstrapClarification(nextState);
        return {
            state: nextClarify.state,
            skipAi: false,
            preparedOk: prepared.ok,
            clarificationOutbound: nextClarify.outbound,
        };
    }

    const skipAi = isDraftStructurallyCompleteForFinalize(nextDraft);
    return {
        state: nextState,
        skipAi,
        preparedOk: prepared.ok,
        clarificationOutbound: [],
    };
}

/** Extrai o id do pick (primeiro da allowlist pós-`applyPick`). */
export function resolvePickedEmbalagemId(state: ProSessionState): string | null {
    const id = state.searchProdutoEmbalagemIds?.[0]?.trim();
    return id || null;
}
