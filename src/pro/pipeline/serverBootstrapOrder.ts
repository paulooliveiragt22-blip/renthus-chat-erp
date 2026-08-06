import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft, PrepareDraftToolInput, ProSessionState, OutboundMessage } from "@/src/types/contracts";
import {
    runSearchProdutosDetailed,
    suggestNearCatalogMatches,
} from "@/src/pro/tools/searchProdutos";
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
    loadCompanySiglas,
    loadCustomerSiglaHabits,
    primaryProductIdFromHits,
} from "./customerPackagingHabit";
import {
    formatAskRepeatProductBody,
    formatNearMissClarificationBody,
} from "./orderDraftPresenter";
import { PICK_EMB_PREFIX } from "./productPickText";
import { buildUniquePickButtons } from "./pickButtonTitles";

function normTerm(s: string): string {
    return s
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

function draftItemsHint(draft: OrderDraft | null | undefined): string | null {
    const items = draft?.items ?? [];
    if (!items.length) return null;
    const parts = items.slice(0, 4).map((it) => {
        const name = String(it.productName ?? "Item").trim() || "Item";
        return `${it.quantity}x ${name}`;
    });
    return `Já anotei: ${parts.join("; ")}.`;
}

/**
 * Bootstrap no servidor: pagamento/endereço + prepare dos segmentos unívocos;
 * ambíguo → clarificação; busca vazia → near-miss ou pedir para repetir (não fecha o pedido).
 */
export async function tryServerBootstrapOrderFromText(params: {
    admin: SupabaseClient;
    companyId: string;
    customerId: string | null;
    state: ProSessionState;
    userText: string;
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
    /**
     * Pagamento só do texto desta mensagem (extração).
     * Não herda `inferredPaymentMethod` nem `draft.paymentMethod` de turno anterior —
     * senão PIX “gruda” no pedido seguinte sem o cliente pedir.
     */
    const paymentFromText = plan?.payment ?? null;
    const continuingCart = Boolean(params.state.draft?.items?.length);
    const payment =
        paymentFromText ??
        (continuingCart ? params.state.draft?.paymentMethod ?? null : null);
    const useSaved = plan?.useSavedAddress === true;

    let state: ProSessionState = {
        ...params.state,
        inferredPaymentMethod: paymentFromText,
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
    const askRepeatTerms: string[] = [];
    /** Segmentos que eram empty e viraram near-miss (mensagem especial). */
    const nearMissSegments = new Set<string>();

    const segmentHits: Array<{
        segment: string;
        items: Awaited<ReturnType<typeof runSearchProdutosDetailed>>["items"];
    }> = [];
    for (const segment of segments) {
        const detailed = await runSearchProdutosDetailed(admin, companyId, segment, { limit: 8 });
        segmentHits.push({ segment, items: detailed.items });
    }

    let habits = new Map<string, string>();
    const companySiglas = await loadCompanySiglas(admin, companyId);
    if (customerId) {
        const productIds = segmentHits
            .map((h) => primaryProductIdFromHits(h.items))
            .filter((id): id is string => Boolean(id));
        if (productIds.length) {
            habits = await loadCustomerSiglaHabits({
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
        const resolved = resolveSegmentPick(segment, items, {
            quantity: qty,
            habitSigla: habit,
            companySiglas,
        });

        if (resolved.kind === "unique") {
            uniqueIds.push(resolved.pick.embalagemId);
            idToTerm.set(resolved.pick.embalagemId, segment);
            continue;
        }
        if (resolved.kind === "ambiguous") {
            ambiguousAll.push({
                segment,
                picks: resolved.picks,
                quantity: qty,
                habitConflict: resolved.habitConflict === true,
                habit,
            });
            continue;
        }

        const near = await suggestNearCatalogMatches(admin, companyId, segment, {
            limit: 3,
            minScore: 0.48,
        });
        if (near.length >= 1) {
            nearMissSegments.add(normTerm(segment));
            ambiguousAll.push({
                segment,
                picks: near.map((n) => ({
                    embalagemId: n.id,
                    label: n.label,
                    price: n.price,
                    productName: n.productName,
                })),
                quantity: qty,
            });
        } else {
            askRepeatTerms.push(segment);
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
            paymentMethod: payment,
            changeFor:
                payment === "cash"
                    ? state.draft?.changeFor ?? null
                    : payment
                      ? null
                      : continuingCart
                        ? state.draft?.changeFor ?? null
                        : null,
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

    const keptHint = draftItemsHint(state.draft);
    const outbound: OutboundMessage[] = [];
    const firstAmbiguous = ambiguousAll[0] ?? null;

    if (firstAmbiguous && firstAmbiguous.picks.length >= 1) {
        const picks = firstAmbiguous.picks.slice(0, 3);
        const isNearMiss = nearMissSegments.has(normTerm(firstAmbiguous.segment));

        if (isNearMiss) {
            state = {
                ...state,
                bootstrapPendingClarifications: ambiguousAll.slice(1),
                lastSearchPicks: picks,
                pendingClarifyQuantity: firstAmbiguous.quantity ?? 1,
                pendingClarifySegment: firstAmbiguous.segment,
                searchProdutoEmbalagemIds: [
                    ...picks.map((p) => p.embalagemId),
                    ...(state.searchProdutoEmbalagemIds ?? []),
                    ...(state.bootstrapResolvedEmbalagemIds ?? []),
                ],
            };
            outbound.push({
                kind: "buttons",
                text: formatNearMissClarificationBody(firstAmbiguous.segment, picks, {
                    keptItemsHint: keptHint,
                }),
                buttons: buildUniquePickButtons(picks, PICK_EMB_PREFIX),
            });
        } else if (picks.length >= 2) {
            const withFirst: ProSessionState = {
                ...state,
                bootstrapPendingClarifications: [
                    {
                        segment: firstAmbiguous.segment,
                        picks,
                        quantity: firstAmbiguous.quantity ?? 1,
                        habitConflict: firstAmbiguous.habitConflict,
                        habit: firstAmbiguous.habit,
                    },
                    ...(state.bootstrapPendingClarifications ?? []),
                ],
            };
            const dequeued = dequeueBootstrapClarification(withFirst);
            state = dequeued.state;
            outbound.push(...dequeued.outbound);
        } else {
            // near-miss com 1 opção já tratado; ambíguo normal exige ≥2
            state = {
                ...state,
                lastSearchPicks: [],
                bootstrapPendingClarifications: ambiguousAll.slice(1),
                pendingClarifyQuantity: null,
                pendingClarifySegment: null,
            };
        }
    } else {
        state = {
            ...state,
            lastSearchPicks: [],
            bootstrapPendingClarifications: [],
            pendingClarifyQuantity: null,
            pendingClarifySegment: null,
        };
    }

    if (askRepeatTerms.length) {
        if (outbound.length === 0) {
            for (const term of askRepeatTerms) {
                outbound.push({
                    kind: "text",
                    text: formatAskRepeatProductBody(term, { keptItemsHint: keptHint }),
                });
            }
        } else {
            state = {
                ...state,
                pendingAskRepeatTerms: [
                    ...(state.pendingAskRepeatTerms ?? []),
                    ...askRepeatTerms,
                ],
            };
        }
    }

    const hasUnresolved =
        outbound.length > 0 ||
        (state.bootstrapPendingClarifications?.length ?? 0) > 0 ||
        (state.pendingAskRepeatTerms?.length ?? 0) > 0;

    return {
        state,
        outbound,
        hasClarification: hasUnresolved,
        bootstrapped: Boolean(
            state.draft?.items?.length ||
                payment ||
                resolvedIds.length ||
                ambiguousAll.length ||
                askRepeatTerms.length
        ),
        segmentSource: "llm",
    };
}
