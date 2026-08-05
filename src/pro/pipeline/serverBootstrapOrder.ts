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
import { resolveSegmentPick, type SegmentPickRow } from "./resolveSegmentPick";
import {
    dequeueBootstrapClarification,
    type BootstrapPendingClarification,
} from "./bootstrapClarifyQueue";

/**
 * Bootstrap no servidor: pagamento/endereço do texto + prepare dos segmentos unívocos;
 * se algum for ambíguo, devolve picks de clarificação e enfileira os demais.
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
    const ambiguousAll: BootstrapPendingClarification[] = [];

    for (const segment of segments) {
        const detailed = await runSearchProdutosDetailed(admin, companyId, segment, { limit: 8 });
        const resolved = resolveSegmentPick(segment, detailed.items);
        if (resolved.kind === "unique") {
            uniqueIds.push(resolved.pick.embalagemId);
        } else if (resolved.kind === "ambiguous") {
            ambiguousAll.push({ segment, picks: resolved.picks });
        }
    }

    const existingIds = (state.draft?.items ?? []).map((i) => i.produtoEmbalagemId);
    const draftIdSet = new Set(existingIds);
    /**
     * Pedido novo: descarta boot antigo (evita CX de clarificação/troca anterior).
     * Adicionar produtos: só mantém IDs que ainda estão no draft.
     */
    const keptBoot = draftIdSet.size
        ? (state.bootstrapResolvedEmbalagemIds ?? []).filter((id) => draftIdSet.has(id))
        : [];
    const resolvedIds = [...new Set([...keptBoot, ...uniqueIds])];
    state = {
        ...state,
        bootstrapResolvedEmbalagemIds: resolvedIds,
        bootstrapPendingClarifications: ambiguousAll.slice(1),
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
    const firstAmbiguous: SegmentPickRow[] | null = ambiguousAll[0]?.picks ?? null;
    if (firstAmbiguous && firstAmbiguous.length >= 2) {
        // Coloca a 1ª na "fila ativa" via dequeue: lastSearchPicks + outbound
        const withFirst: ProSessionState = {
            ...state,
            bootstrapPendingClarifications: [
                { segment: ambiguousAll[0]!.segment, picks: firstAmbiguous },
                ...(state.bootstrapPendingClarifications ?? []),
            ],
        };
        const dequeued = dequeueBootstrapClarification(withFirst);
        state = dequeued.state;
        outbound.push(...dequeued.outbound);
    } else {
        state = { ...state, lastSearchPicks: [], bootstrapPendingClarifications: [] };
    }

    return {
        state,
        outbound,
        hasClarification: outbound.length > 0,
        bootstrapped: Boolean(
            state.draft?.items?.length ||
                payment ||
                resolvedIds.length ||
                ambiguousAll.length
        ),
    };
}
