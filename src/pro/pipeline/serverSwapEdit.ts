import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, ProSessionState } from "@/src/types/contracts";
import { runSearchProdutosDetailed } from "@/src/pro/tools/searchProdutos";
import { formatSearchPicksClarificationBody } from "./orderDraftPresenter";
import { PICK_EMB_PREFIX } from "./productPickText";
import { buildUniquePickButtons } from "./pickButtonTitles";
import { catalogProductHintFromPicks } from "./catalogProductHint";
import {
    removeDraftItemsMatchingName,
    removeDraftItemsMatchingNameExcept,
} from "./mergeOrderDraft";
import { serverPrepareAfterProductPick } from "./serverPrepareAfterPick";
import { withResolvedSlotStep } from "./orderSlotStep";
import { checkoutPostProcessForQuickAction } from "./stages/checkoutPostProcess";
import type { CheckoutSwapIntent } from "@/src/domain/contracts/orderExtraction";

function buildSwapClarifyButtons(
    picks: Array<{
        embalagemId: string;
        label: string;
        price?: number | null;
        productName?: string | null;
    }>
): OutboundMessage | null {
    const top = picks.slice(0, 3);
    if (top.length < 2) return null;
    const productHint = catalogProductHintFromPicks(top);
    return {
        kind: "buttons",
        text: formatSearchPicksClarificationBody(top, { productHint }),
        buttons: buildUniquePickButtons(top, PICK_EMB_PREFIX),
    };
}

export type ServerSwapEditResult =
    | { handled: false }
    | {
          handled: true;
          state: ProSessionState;
          outbound: OutboundMessage[];
          /** Prepare completo → já pode ir ao resumo. */
          finalized: boolean;
      };

function resolveSwapIntent(swapIntent?: CheckoutSwapIntent | null): CheckoutSwapIntent | null {
    if (swapIntent?.removeName && swapIntent.searchQuery) return swapIntent;
    return null;
}

/**
 * Troca/substitui determinística no servidor após intent LLM:
 * busca o produto certo, remove o antigo e prepare — sem regex de linguagem.
 */
export async function tryServerSwapEdit(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
    userText: string;
    /** Intent de troca já extraído pelo LLM. */
    swapIntent?: CheckoutSwapIntent | null;
}): Promise<ServerSwapEditResult> {
    const { admin, companyId, customerId } = params;
    if (!params.state.draft?.items?.length) return { handled: false };

    const swap = resolveSwapIntent(params.swapIntent);
    if (!swap) return { handled: false };

    const detailed = await runSearchProdutosDetailed(admin, companyId, swap.searchQuery, {
        limit: 6,
    });
    const picks = detailed.items.slice(0, 3).map((r) => ({
        embalagemId: String(r.id),
        label: String(r.display_name || r.product_name || "Item").slice(0, 40),
        price: Number.isFinite(Number(r.preco_venda)) ? Number(r.preco_venda) : null,
        productName: String(r.product_name ?? "").trim() || null,
    }));

    if (!picks.length) {
        return {
            handled: true,
            finalized: false,
            state: {
                ...params.state,
                step: "pro_collecting_order",
                checkoutEditHold: true,
                lastSearchPicks: [],
                pendingSwapRemoveName: swap.removeName,
            },
            outbound: [
                {
                    kind: "text",
                    text:
                        `Não encontrei substituto para "${swap.removeName}". ` +
                        "Tente outro nome (ex.: salgadinho caixa) ou diga o produto completo.",
                },
            ],
        };
    }

    if (picks.length === 1) {
        const sole = picks[0]!;
        const beforeIds = new Set(
            (params.state.draft?.items ?? []).map((i) => i.produtoEmbalagemId).filter(Boolean)
        );
        const strippedDraft = removeDraftItemsMatchingName(params.state.draft, swap.removeName);
        const afterIds = new Set(
            (strippedDraft?.items ?? []).map((i) => i.produtoEmbalagemId).filter(Boolean)
        );
        const removedIds = new Set([...beforeIds].filter((id) => !afterIds.has(id)));
        const baseState: ProSessionState = {
            ...params.state,
            draft: strippedDraft,
            pendingSwapRemoveName: null,
            step: "pro_collecting_order",
            checkoutEditHold: true,
            lastSearchPicks: [],
            bootstrapResolvedEmbalagemIds: (
                params.state.bootstrapResolvedEmbalagemIds ?? []
            ).filter((id) => id && !removedIds.has(id)),
            searchProdutoEmbalagemIds: [
                sole.embalagemId,
                ...(strippedDraft?.items ?? []).map((i) => i.produtoEmbalagemId),
            ],
        };
        const prepared = await serverPrepareAfterProductPick({
            admin,
            companyId,
            customerId,
            state: baseState,
            pickedEmbalagemId: sole.embalagemId,
        });
        const cleanedDraft = removeDraftItemsMatchingNameExcept(
            prepared.state.draft,
            swap.removeName,
            [sole.embalagemId]
        );
        const keptIds = new Set(
            (cleanedDraft?.items ?? []).map((i) => i.produtoEmbalagemId).filter(Boolean)
        );
        const cleanedState: ProSessionState = {
            ...prepared.state,
            draft: cleanedDraft,
            pendingSwapRemoveName: null,
            bootstrapResolvedEmbalagemIds: (
                prepared.state.bootstrapResolvedEmbalagemIds ?? []
            ).filter((id) => id && keptIds.has(id)),
        };
        if (prepared.skipAi && cleanedDraft) {
            const finalState = withResolvedSlotStep({
                ...cleanedState,
                checkoutEditHold: false,
            });
            return {
                handled: true,
                finalized: true,
                state: finalState,
                outbound: checkoutPostProcessForQuickAction({ state: finalState, outbound: [] }),
            };
        }
        return {
            handled: true,
            finalized: false,
            state: {
                ...cleanedState,
                checkoutEditHold: true,
            },
            outbound: [
                {
                    kind: "text",
                    text: `Atualizei: removi "${swap.removeName}" e acrescentei ${sole.label}.`,
                },
            ],
        };
    }

    const clarify = buildSwapClarifyButtons(picks);
    /** Já remove o item antigo do draft+boot; o pick só acrescenta o substituto. */
    const beforeIds = new Set(
        (params.state.draft?.items ?? []).map((i) => i.produtoEmbalagemId).filter(Boolean)
    );
    const strippedDraft = removeDraftItemsMatchingName(params.state.draft, swap.removeName);
    const afterIds = new Set(
        (strippedDraft?.items ?? []).map((i) => i.produtoEmbalagemId).filter(Boolean)
    );
    const removedIds = new Set([...beforeIds].filter((id) => !afterIds.has(id)));
    const nextState: ProSessionState = {
        ...params.state,
        draft: strippedDraft,
        step: "pro_collecting_order",
        checkoutEditHold: true,
        pendingSwapRemoveName: swap.removeName,
        lastSearchPicks: picks,
        bootstrapResolvedEmbalagemIds: (params.state.bootstrapResolvedEmbalagemIds ?? []).filter(
            (id) => id && !removedIds.has(id)
        ),
        searchProdutoEmbalagemIds: picks.map((p) => p.embalagemId),
    };

    return {
        handled: true,
        finalized: false,
        state: nextState,
        outbound: prioritizeSwapOutbound(clarify, swap, picks),
    };
}

function prioritizeSwapOutbound(
    clarify: OutboundMessage | null,
    swap: { removeName: string; replaceHint: string },
    picks: Array<{
        label?: string | null;
        productName?: string | null;
    }>
): OutboundMessage[] {
    const catalogHint =
        catalogProductHintFromPicks(picks) ??
        String(swap.replaceHint ?? "")
            .replaceAll(/\s+/g, " ")
            .trim()
            .slice(0, 40);
    const intro: OutboundMessage = {
        kind: "text",
        text: catalogHint
            ? `Certo — vou trocar "${swap.removeName}" por uma opção de "${catalogHint}". Qual embalagem?`
            : `Certo — vou trocar "${swap.removeName}". Qual embalagem?`,
    };
    if (!clarify) return [intro];
    return [intro, clarify];
}
