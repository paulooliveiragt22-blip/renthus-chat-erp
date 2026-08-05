import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderDraft, PrepareDraftToolInput, ProSessionState } from "@/src/types/contracts";
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
import type { OutboundMessage } from "@/src/types/contracts";

type PickRow = { embalagemId: string; label: string; price?: number | null };

function rowToPick(r: {
    id: string;
    display_name?: string | null;
    product_name?: string | null;
    preco_venda?: number | null;
}): PickRow {
    return {
        embalagemId: String(r.id),
        label: String(r.display_name || r.product_name || "Item").slice(0, 40),
        price: Number.isFinite(Number(r.preco_venda)) ? Number(r.preco_venda) : null,
    };
}

function prefersCase(segment: string): boolean {
    const t = segment.toLowerCase().normalize("NFD").replaceAll(/\p{Diacritic}/gu, "");
    return /\b(caixa|cx|fardo|pack)\b/u.test(t);
}

/**
 * Se o segmento pede caixa e há exatamente uma linha CX nos resultados, resolve sozinho.
 * Se há 1 resultado no total, resolve. Caso contrário, ambíguo.
 */
function resolveSegmentPick(
    segment: string,
    items: Array<{
        id: string;
        display_name?: string | null;
        product_name?: string | null;
        preco_venda?: number | null;
        sigla_comercial?: string | null;
    }>
): { kind: "unique"; pick: PickRow } | { kind: "ambiguous"; picks: PickRow[] } | { kind: "empty" } {
    if (!items.length) return { kind: "empty" };
    if (items.length === 1) return { kind: "unique", pick: rowToPick(items[0]!) };

    if (prefersCase(segment)) {
        const cx = items.filter((r) => {
            const sigla = String(r.sigla_comercial ?? "").toUpperCase();
            const name = String(r.display_name || r.product_name || "").toUpperCase();
            return sigla.includes("CX") || /\bCX\b|CAIXA|C\/\d+/u.test(name);
        });
        if (cx.length === 1) return { kind: "unique", pick: rowToPick(cx[0]!) };
        if (cx.length >= 2) return { kind: "ambiguous", picks: cx.slice(0, 3).map(rowToPick) };
    }

    return { kind: "ambiguous", picks: items.slice(0, 3).map(rowToPick) };
}

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
    /** Há ambiguidades — não pular IA se ainda precisar de prosa; mas clarify já vai no outbound. */
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
    let firstAmbiguous: PickRow[] | null = null;

    for (const segment of segments) {
        const detailed = await runSearchProdutosDetailed(admin, companyId, segment, { limit: 6 });
        const resolved = resolveSegmentPick(segment, detailed.items as Array<{
            id: string;
            display_name?: string | null;
            product_name?: string | null;
            preco_venda?: number | null;
            sigla_comercial?: string | null;
        }>);
        if (resolved.kind === "unique") {
            uniqueIds.push(resolved.pick.embalagemId);
        } else if (resolved.kind === "ambiguous" && !firstAmbiguous) {
            firstAmbiguous = resolved.picks;
        }
    }

    if (!uniqueIds.length && !firstAmbiguous) {
        return { state, outbound: [], hasClarification: false, bootstrapped: Boolean(payment) };
    }

    const existingIds = (state.draft?.items ?? []).map((i) => i.produtoEmbalagemId);
    const allIds = [...new Set([...existingIds, ...uniqueIds])];

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
                searchProdutoEmbalagemIds: unionAllowlistWithDraftIds(
                    allIds,
                    nextDraft
                ),
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
        bootstrapped: Boolean(state.draft?.items?.length || payment),
    };
}
