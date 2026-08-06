import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutboundMessage, ProSessionState } from "@/src/types/contracts";
import { runSearchProdutosDetailed } from "@/lib/chatbot/pro/searchProdutos";
import { formatSearchPicksClarificationBody } from "./orderDraftPresenter";
import { buildUniquePickButtons } from "./pickButtonTitles";
import { parseCheckoutSwapIntent } from "./editIntentParse";
import {
    removeDraftItemsMatchingName,
    removeDraftItemsMatchingNameExcept,
} from "./mergeOrderDraft";
import { serverPrepareAfterProductPick } from "./serverPrepareAfterPick";
import { withResolvedSlotStep } from "./orderSlotStep";
import { checkoutPostProcessForQuickAction } from "./stages/checkoutPostProcess";

function buildSwapClarifyButtons(
    picks: Array<{ embalagemId: string; label: string; price?: number | null }>
): OutboundMessage | null {
    const top = picks.slice(0, 3);
    if (top.length < 2) return null;
    return {
        kind: "buttons",
        text: formatSearchPicksClarificationBody(top),
        buttons: buildUniquePickButtons(top),
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

/**
 * Troca/substitui determinística (ex.: "troca o salgadinho pela caixa de 15"):
 * busca o produto certo, remove o antigo e prepare — sem depender da IA inventar a query.
 */
export async function tryServerSwapEdit(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
    userText: string;
}): Promise<ServerSwapEditResult> {
    const { admin, companyId, customerId, userText } = params;
    if (!params.state.draft?.items?.length) return { handled: false };

    const swap = parseCheckoutSwapIntent(userText);
    if (!swap) return { handled: false };

    const detailed = await runSearchProdutosDetailed(admin, companyId, swap.searchQuery, {
        limit: 6,
    });
    const picks = detailed.items.slice(0, 3).map((r) => ({
        embalagemId: String(r.id),
        label: String(r.display_name || r.product_name || "Item").slice(0, 40),
        price: Number.isFinite(Number(r.preco_venda)) ? Number(r.preco_venda) : null,
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
                        `Nao encontrei substituto para "${swap.removeName}" com "${swap.replaceHint}". ` +
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
        outbound: prioritizeSwapOutbound(clarify, swap),
    };
}

function prioritizeSwapOutbound(
    clarify: OutboundMessage | null,
    swap: { removeName: string; replaceHint: string }
): OutboundMessage[] {
    const intro: OutboundMessage = {
        kind: "text",
        text: `Certo — vou trocar "${swap.removeName}" por uma opcao de "${swap.replaceHint}". Qual embalagem?`,
    };
    if (!clarify) return [intro];
    return [intro, clarify];
}
