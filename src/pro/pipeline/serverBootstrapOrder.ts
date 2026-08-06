import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft, PrepareDraftToolInput, ProSessionState, OutboundMessage } from "@/src/types/contracts";
import { runSearchProdutosDetailed } from "@/src/pro/tools/searchProdutos";
import {
    prepareOrderDraftFromTool,
    type PrepareOrderDraftCatalogPolicy,
} from "@/src/pro/tools/prepareOrderDraft";
import { mergePreparedDraftIntoCurrent, unionAllowlistWithDraftIds } from "./mergeOrderDraft";
import { resolveSegmentPick, type SegmentPickRow } from "./resolveSegmentPick";
import {
    dequeueBootstrapClarification,
    type BootstrapPendingClarification,
} from "./bootstrapClarifyQueue";
import {
    buildBootstrapSegmentPlanFromExtraction,
    type BootstrapSegmentPlan,
} from "./bootstrapSegmentPlan";
import {
    loadCustomerPackagingHabits,
    primaryProductIdFromHits,
} from "./customerPackagingHabit";

function normTerm(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

/**
 * Bootstrap no servidor: pagamento/endereço + prepare dos segmentos unívocos;
 * se algum for ambíguo, devolve picks de clarificação e enfileira os demais.
 */
export async function tryServerBootstrapOrderFromText(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
    userText: string;
    /** Plano de segmentos (somente LLM). Obrigatório para bootstrap. */
    segmentPlan?: BootstrapSegmentPlan | null;
}): Promise<{
    state: ProSessionState;
    outbound: OutboundMessage[];
    hasClarification: boolean;
    bootstrapped: boolean;
    segmentSource: "llm";
}> {
    const { admin, companyId, customerId } = params;
    const plan =
        params.segmentPlan ?? buildBootstrapSegmentPlanFromExtraction(null);
    const segments = plan?.segments ?? [];
    const payment = plan?.payment ?? params.state.inferredPaymentMethod ?? null;
    const useSaved = plan?.useSavedAddress === true;

    let state: ProSessionState = {
        ...params.state,
        inferredPaymentMethod: payment ?? params.state.inferredPaymentMethod ?? null,
        step:
            params.state.step === "pro_idle" || params.state.step === "pro_awaiting_confirmation"
                ? "pro_collecting_order"
                : params.state.step,
    };

    if (segments.length < 1 || !plan) {
        return {
            state,
            outbound: [],
            hasClarification: false,
            bootstrapped: false,
            segmentSource: "llm",
        };
    }

    const uniqueIds: string[] = [];
    const idToTerm = new Map<string, string>();
    const ambiguousAll: BootstrapPendingClarification[] = [];

    /** Pré-busca para coletar product_ids e hábitos do cliente. */
    const segmentHits: Array<{
        segment: string;
        items: Awaited<ReturnType<typeof runSearchProdutosDetailed>>["items"];
    }> = [];
    for (const segment of segments) {
        const detailed = await runSearchProdutosDetailed(admin, companyId, segment, { limit: 8 });
        segmentHits.push({ segment, items: detailed.items });
    }

    let habits = new Map<string, "UN" | "CX">();
    if (customerId) {
        const productIds = segmentHits
            .map((h) => primaryProductIdFromHits(h.items))
            .filter((id): id is string => Boolean(id));
        if (productIds.length) {
            habits = await loadCustomerPackagingHabits({
                admin,
                companyId,
                customerId,
                productIds,
            });
        }
    }

    for (const { segment, items } of segmentHits) {
        const qty = plan.qtyByTerm[normTerm(segment)] ?? 1;
        const productId = primaryProductIdFromHits(items);
        const habit = productId ? habits.get(productId) ?? null : null;
        const resolved = resolveSegmentPick(segment, items, { quantity: qty, habit });
        if (resolved.kind === "unique") {
            uniqueIds.push(resolved.pick.embalagemId);
            idToTerm.set(resolved.pick.embalagemId, segment);
        } else if (resolved.kind === "ambiguous") {
            ambiguousAll.push({
                segment,
                picks: resolved.picks,
                quantity: qty,
                habitConflict: resolved.habitConflict === true,
                habit,
            });
        }
    }

    const existingIds = (state.draft?.items ?? []).map((i) => i.produtoEmbalagemId);
    const draftIdSet = new Set(existingIds);
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
                const term = idToTerm.get(id);
                const fromPlan = term ? plan.qtyByTerm[normTerm(term)] : undefined;
                return {
                    produtoEmbalagemId: id,
                    quantity: prev?.quantity ?? fromPlan ?? 1,
                };
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
        const withFirst: ProSessionState = {
            ...state,
            bootstrapPendingClarifications: [
                {
                    segment: ambiguousAll[0]!.segment,
                    picks: firstAmbiguous,
                    quantity: ambiguousAll[0]!.quantity ?? 1,
                    habitConflict: ambiguousAll[0]!.habitConflict,
                    habit: ambiguousAll[0]!.habit,
                },
                ...(state.bootstrapPendingClarifications ?? []),
            ],
        };
        const dequeued = dequeueBootstrapClarification(withFirst);
        state = dequeued.state;
        outbound.push(...dequeued.outbound);
    } else {
        state = {
            ...state,
            lastSearchPicks: [],
            bootstrapPendingClarifications: [],
            pendingClarifyQuantity: null,
            pendingClarifySegment: null,
        };
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
        segmentSource: "llm",
    };
}
