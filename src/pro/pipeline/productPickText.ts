/**
 * Seleção determinística de embalagem: botão `pro_pick_emb:` ou texto "opção 2" / "2".
 */

import type { ProSessionState } from "@/src/types/contracts";
import { removeDraftItemsByEmbalagemIds } from "./mergeOrderDraft";
import { removePendingPickGroupContaining } from "./pendingPickGroups";

export const PICK_EMB_PREFIX = "pro_pick_emb:";

const ORDINAL: Record<string, number> = {
    "1": 1,
    "2": 2,
    "3": 3,
    primeira: 1,
    primeiro: 1,
    segunda: 2,
    segundo: 2,
    terceira: 3,
    terceiro: 3,
    um: 1,
    uma: 1,
    dois: 2,
    duas: 2,
    tres: 3,
};

function normalizePickText(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ");
}

/**
 * Índice 1-based a partir de "2", "opcao 2", "segunda", etc.
 * `maxIndex` = tamanho da lista na sessão (promo/combo pode passar de 3).
 */
export function parseProductPickIndex(text: string, maxIndex = 3): number | null {
    const cap = Math.min(Math.max(1, Math.floor(maxIndex)), 12);
    const t = normalizePickText(text);
    if (!t) return null;

    if (/^\d{1,2}$/u.test(t)) {
        const n = Number(t);
        return n >= 1 && n <= cap ? n : null;
    }

    const mOpcao = t.match(/^(?:opcao|opcao:|op)\s*(\d{1,2})$/u);
    if (mOpcao) {
        const n = Number(mOpcao[1]);
        return n >= 1 && n <= cap ? n : null;
    }

    const mNumero = t.match(/^(?:numero|n[uº]?)\s*(\d{1,2})$/u);
    if (mNumero) {
        const n = Number(mNumero[1]);
        return n >= 1 && n <= cap ? n : null;
    }

    if (ORDINAL[t] != null) {
        const n = ORDINAL[t]!;
        return n >= 1 && n <= cap ? n : null;
    }

    const mOrd = t.match(/^(primeira|primeira opcao|segunda|segunda opcao|terceira|terceira opcao)$/u);
    if (mOrd) {
        const key = mOrd[1]!.split(" ")[0]!;
        const n = ORDINAL[key];
        return n != null && n >= 1 && n <= cap ? n : null;
    }

    return null;
}

function buildAppendSyntheticText(label: string, embId: string, state: ProSessionState): string {
    const existingCount = state.draft?.items?.length ?? 0;
    const keepHint = existingCount
        ? " Mantenha todos os itens ja no rascunho do servidor; prepare e aditivo."
        : "";
    // UUID só em instrução interna — a resposta ao cliente é sanitizada, mas evitamos eco.
    return (
        `[interno] Cliente escolheu a embalagem "${label}" (id allowlist ${embId}), quantity 1. ` +
        `Chame prepare_order_draft com esse id e NÃO cite UUID nem produto_embalagem_id ao cliente.` +
        keepHint
    );
}

function applyPick(
    embId: string,
    label: string,
    state: ProSessionState
): { state: ProSessionState; syntheticUserText: string } {
    /** Outras opções do mesmo card de clarificação — não podem voltar no prepare. */
    const rejectedSiblingIds = (state.lastSearchPicks ?? [])
        .map((p) => String(p.embalagemId ?? "").trim())
        .filter((id) => id && id !== embId);
    const rejectSet = new Set(rejectedSiblingIds);

    const draftAfterReject = removeDraftItemsByEmbalagemIds(state.draft, rejectedSiblingIds);
    const bootIds = (state.bootstrapResolvedEmbalagemIds ?? []).filter(
        (id) => id && id !== embId && !rejectSet.has(id)
    );
    const draftIds = (draftAfterReject?.items ?? [])
        .map((i) => i.produtoEmbalagemId)
        .filter((id) => id && !rejectSet.has(id));
    const allow = [embId, ...draftIds.filter((id) => id !== embId), ...bootIds.filter((id) => id !== embId)];
    const step =
        state.step === "pro_idle" ||
        state.step === "pro_awaiting_confirmation" ||
        state.step === "pro_awaiting_cart_review"
            ? "pro_collecting_order"
            : state.step;
    return {
        state: {
            ...state,
            step,
            draft: draftAfterReject,
            bootstrapResolvedEmbalagemIds: bootIds,
            checkoutEditHold:
                state.step === "pro_awaiting_confirmation" ||
                state.step === "pro_awaiting_cart_review"
                    ? true
                    : state.checkoutEditHold,
            cartReviewAcknowledged: false,
            cartReviewFingerprint: null,
            searchProdutoEmbalagemIds: allow,
            lastSearchPicks: [],
            pendingPickGroups: removePendingPickGroupContaining(
                state.pendingPickGroups ?? [],
                embId
            ),
        },
        syntheticUserText: buildAppendSyntheticText(label, embId, {
            ...state,
            draft: draftAfterReject,
        }),
    };
}

function clearOfferPicks(state: ProSessionState): ProSessionState {
    if (!state.pendingCatalogOfferPicks?.length) return state;
    return { ...state, pendingCatalogOfferPicks: null };
}

export function applyProductPickFromInbound(
    text: string,
    state: ProSessionState
): { state: ProSessionState; syntheticUserText: string | null } {
    const raw = text.trim();
    if (raw.toLowerCase().startsWith(PICK_EMB_PREFIX)) {
        const embId = raw.slice(PICK_EMB_PREFIX.length).trim();
        if (!embId) return { state, syntheticUserText: null };
        const pick =
            (state.pendingCatalogOfferPicks ?? []).find((p) => p.embalagemId === embId) ??
            (state.lastSearchPicks ?? []).find((p) => p.embalagemId === embId);
        const label = pick?.label ?? "item";
        const applied = applyPick(embId, label, state);
        return { state: clearOfferPicks(applied.state), syntheticUserText: applied.syntheticUserText };
    }

    const offerPicks = state.pendingCatalogOfferPicks ?? [];
    if (offerPicks.length >= 1) {
        const offerIdx = parseProductPickIndex(raw, offerPicks.length);
        if (offerIdx != null && offerIdx >= 1 && offerIdx <= offerPicks.length) {
            const pick = offerPicks[offerIdx - 1]!;
            const applied = applyPick(pick.embalagemId, pick.label ?? `opcao ${offerIdx}`, state);
            return {
                state: clearOfferPicks(applied.state),
                syntheticUserText: applied.syntheticUserText,
            };
        }
    }

    const picks = state.lastSearchPicks ?? [];
    if (picks.length < 2) return { state, syntheticUserText: null };

    const idx = parseProductPickIndex(raw, picks.length);
    if (idx == null || idx < 1 || idx > picks.length) {
        return { state, syntheticUserText: null };
    }

    const pick = picks[idx - 1]!;
    const embId = pick.embalagemId;
    const label = pick.label ?? `opcao ${idx}`;
    const applied = applyPick(embId, label, state);
    return { state: clearOfferPicks(applied.state), syntheticUserText: applied.syntheticUserText };
}
