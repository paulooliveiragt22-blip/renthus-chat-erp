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
} from "@/src/pro/tools/prepareOrderDraft";
import {
    mergePreparedDraftIntoCurrent,
    removeDraftItemsMatchingName,
    removeDraftItemsMatchingNameExcept,
    unionAllowlistWithDraftIds,
} from "./mergeOrderDraft";
import { isDraftStructurallyCompleteForFinalize } from "./orderDraftGate";
import { isAddressStructurallyComplete } from "./orderSlotStep";
import { formatAskRepeatProductBody } from "./orderDraftPresenter";
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
    /**
     * Se true, `pendingClarifyQuantity` (ou 1) é somada à qty já no draft.
     * Usado em “quer adicionar mais?” → “2”.
     */
    additiveQuantity?: boolean;
}): Promise<{
    state: ProSessionState;
    /** Draft ficou completo o bastante para ir ao resumo sem IA. */
    skipAi: boolean;
    preparedOk: boolean;
    /** Próxima clarificação multi-item (se houver). */
    clarificationOutbound: OutboundMessage[];
}> {
    const { admin, companyId, customerId, pickedEmbalagemId } = params;
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
    const clarifyQty = Number(state.pendingClarifyQuantity);
    const qtyFromClarify =
        Number.isFinite(clarifyQty) && clarifyQty > 0 ? clarifyQty : null;
    const addQty = qtyFromClarify ?? 1;
    const nextQty = params.additiveQuantity
        ? (prev?.quantity ?? 0) + addQty
        : (prev?.quantity ?? qtyFromClarify ?? 1);
    byId.set(embId, {
        produtoEmbalagemId: embId,
        quantity: Math.max(1, nextQty),
    });

    const resolvedIds = [
        ...new Set([...(state.bootstrapResolvedEmbalagemIds ?? []), embId]),
    ];

    const addr = state.draft?.address;
    /** Só pagamento já no draft (botões). Não herdar inferred sticky da sessão. */
    const paymentMethod = state.draft?.paymentMethod ?? null;
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
        /**
         * Nunca resolve endereço salvo/histórico silenciosamente após um pick de produto.
         * Isso é decisão explícita do cliente (via LLM + get_order_hints), não um default
         * automático — evita confirmar endereço de pedido anterior sem o cliente pedir.
         */
        useSavedAddress: false,
        paymentMethod,
        changeFor:
            paymentMethod === "cash" ? state.draft?.changeFor ?? null : null,
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
        pendingClarifyQuantity: null,
        pendingClarifySegment: null,
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

    const pendingRepeat = [...(nextState.pendingAskRepeatTerms ?? [])];
    if (pendingRepeat.length) {
        const hintParts = (nextDraft?.items ?? []).slice(0, 4).map((it) => {
            const name = String(it.productName ?? "Item").trim() || "Item";
            return `${it.quantity}x ${name}`;
        });
        const keptHint = hintParts.length ? `Já anotei: ${hintParts.join("; ")}.` : null;
        return {
            state: { ...nextState, pendingAskRepeatTerms: [] },
            skipAi: true,
            preparedOk: prepared.ok,
            clarificationOutbound: pendingRepeat.map((term) => ({
                kind: "text" as const,
                text: formatAskRepeatProductBody(term, { keptItemsHint: keptHint }),
            })),
        };
    }

    const readyForPaymentUi =
        Boolean(nextDraft?.items?.length) &&
        isAddressStructurallyComplete(nextDraft?.address ?? null) &&
        !nextDraft?.paymentMethod;

    /** Completo para fechar OU só falta pagamento: não chama LLM (servidor manda botões). */
    const skipAi = isDraftStructurallyCompleteForFinalize(nextDraft!) || readyForPaymentUi;
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
