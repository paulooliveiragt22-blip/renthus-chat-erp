import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft, PrepareDraftToolInput, ProSessionState, OutboundMessage } from "@/src/types/contracts";
import { runSearchProdutosDetailed } from "@/lib/chatbot/pro/searchProdutos";
import {
    prepareOrderDraftFromTool,
    type PrepareOrderDraftCatalogPolicy,
} from "@/lib/chatbot/pro/prepareOrderDraft";
import { mergePreparedDraftIntoCurrent, unionAllowlistWithDraftIds } from "./mergeOrderDraft";
import { parseMultiItemOrderSegments } from "./parseMultiItemOrderSegments";
import {
    inferPaymentMethodFromText,
    inferUseSavedAddressFromText,
} from "./inferPaymentFromText";
import { formatSearchPicksClarificationBody } from "./orderDraftPresenter";
import { PICK_EMB_PREFIX } from "./productPickText";
import { resolveSegmentPick, type SegmentPickRow } from "./resolveSegmentPick";

/**
 * Bootstrap no servidor: pagamento/endereço do texto + prepare dos segmentos unívocos;
 * se algum for ambíguo, devolve picks de clarificação (sem depender da IA).
 */
export async function tryServerBootstrapOrderFromText(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
    userText: string;
}): Promise<{
    state: ProSessionState;
    outbound: OutboundMessage[];
    hasClarification: boolean;
    bootstrapped: boolean;
}> {
    const { admin, companyId, customerId, userText } = params;
    const segments = parseMultiItemOrderSegments(userText);
    const payment =
        params.state.draft?.paymentMethod ??
        params.state.inferredPaymentMethod ??
        inferPaymentMethodFromText(userText);
    const useSaved = inferUseSavedAddressFromText(userText);

    let state: ProSessionState = {
        ...params.state,
        inferredPaymentMethod: payment ?? params.state.inferredPaymentMethod ?? null,
        step:
            params.state.step === "pro_idle" || params.state.step === "pro_awaiting_confirmation"
                ? "pro_collecting_order"
                : params.state.step,
    };

    if (segments.length < 1) {
        return { state, outbound: [], hasClarification: false, bootstrapped: false };
    }

    const uniqueIds: string[] = [];
    let firstAmbiguous: SegmentPickRow[] | null = null;

    for (const segment of segments) {
        const detailed = await runSearchProdutosDetailed(admin, companyId, segment, { limit: 8 });
        const resolved = resolveSegmentPick(segment, detailed.items);
        if (resolved.kind === "unique") {
            uniqueIds.push(resolved.pick.embalagemId);
        } else if (resolved.kind === "ambiguous" && !firstAmbiguous) {
            firstAmbiguous = resolved.picks;
        }
    }

    const existingIds = (state.draft?.items ?? []).map((i) => i.produtoEmbalagemId);
    const resolvedIds = [...new Set([...(state.bootstrapResolvedEmbalagemIds ?? []), ...uniqueIds])];
    state = {
        ...state,
        bootstrapResolvedEmbalagemIds: resolvedIds,
    };

    const allIds = [...new Set([...existingIds, ...resolvedIds])];

    if (allIds.length) {
        const addr = state.draft?.address;
        const toolInput: PrepareDraftToolInput = {
            items: allIds.map((id) => {
                const prev = state.draft?.items?.find((i) => i.produtoEmbalagemId === id);
                return { produtoEmbalagemId: id, quantity: prev?.quantity ?? 1 };
            }),
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
            useSavedAddress: useSaved || !addr,
            paymentMethod: payment ?? state.draft?.paymentMethod ?? null,
            changeFor: state.draft?.changeFor ?? null,
        };
        const catalogPolicy: PrepareOrderDraftCatalogPolicy = {
            kind: "search_allowlist",
            allowedEmbalagemIds: unionAllowlistWithDraftIds(allIds, state.draft),
        };
        const prepared = await prepareOrderDraftFromTool(
            admin,
            companyId,
            customerId,
            toolInput,
            catalogPolicy
        );
        const nextDraft: OrderDraft | null = mergePreparedDraftIntoCurrent(
            state.draft,
            prepared.draft
        );
        if (nextDraft?.items?.length) {
            state = {
                ...state,
                draft: nextDraft,
                searchProdutoEmbalagemIds: unionAllowlistWithDraftIds(allIds, nextDraft),
            };
        }
    }

    const outbound: OutboundMessage[] = [];
    if (firstAmbiguous && firstAmbiguous.length >= 2) {
        state = {
            ...state,
            lastSearchPicks: firstAmbiguous,
            searchProdutoEmbalagemIds: [
                ...firstAmbiguous.map((p) => p.embalagemId),
                ...(state.searchProdutoEmbalagemIds ?? []),
                ...resolvedIds,
            ],
        };
        outbound.push({
            kind: "buttons",
            text: formatSearchPicksClarificationBody(firstAmbiguous),
            buttons: firstAmbiguous.map((p, i) => ({
                id: `${PICK_EMB_PREFIX}${p.embalagemId}`,
                title: String(p.label ?? `Opcao ${i + 1}`)
                    .replaceAll(/\s+/g, " ")
                    .trim()
                    .slice(0, 20),
            })),
        });
    } else {
        state = { ...state, lastSearchPicks: [] };
    }

    return {
        state,
        outbound,
        hasClarification: outbound.length > 0,
        bootstrapped: Boolean(state.draft?.items?.length || payment || resolvedIds.length),
    };
}
