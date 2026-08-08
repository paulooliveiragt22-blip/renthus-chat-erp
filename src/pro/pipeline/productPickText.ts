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

/** Índice 1-based a partir de "2", "opcao 2", "segunda", etc. */
export function parseProductPickIndex(text: string): number | null {
    const t = normalizePickText(text);
    if (!t) return null;

    if (/^\d{1,2}$/u.test(t)) {
        const n = Number(t);
        return n >= 1 && n <= 3 ? n : null;
    }

    const mOpcao = t.match(/^(?:opcao|opcao:|op)\s*(\d{1,2})$/u);
    if (mOpcao) {
        const n = Number(mOpcao[1]);
        return n >= 1 && n <= 3 ? n : null;
    }

    const mNumero = t.match(/^(?:numero|n[uº]?)\s*(\d{1,2})$/u);
    if (mNumero) {
        const n = Number(mNumero[1]);
        return n >= 1 && n <= 3 ? n : null;
    }

    if (ORDINAL[t] != null) return ORDINAL[t];

    const mOrd = t.match(/^(primeira|primeira opcao|segunda|segunda opcao|terceira|terceira opcao)$/u);
    if (mOrd) {
        const key = mOrd[1]!.split(" ")[0]!;
        return ORDINAL[key] ?? null;
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
        state.step === "pro_idle" || state.step === "pro_awaiting_confirmation"
            ? "pro_collecting_order"
            : state.step;
    return {
        state: {
            ...state,
            step,
            draft: draftAfterReject,
            bootstrapResolvedEmbalagemIds: bootIds,
            checkoutEditHold: state.step === "pro_awaiting_confirmation" ? true : state.checkoutEditHold,
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

export function applyProductPickFromInbound(
    text: string,
    state: ProSessionState
): { state: ProSessionState; syntheticUserText: string | null } {
    const raw = text.trim();
    if (raw.toLowerCase().startsWith(PICK_EMB_PREFIX)) {
        const embId = raw.slice(PICK_EMB_PREFIX.length).trim();
        if (!embId) return { state, syntheticUserText: null };
        const pick = (state.lastSearchPicks ?? []).find((p) => p.embalagemId === embId);
        const label = pick?.label ?? "item";
        return applyPick(embId, label, state);
    }

    const picks = state.lastSearchPicks ?? [];
    if (picks.length < 2) return { state, syntheticUserText: null };

    const idx = parseProductPickIndex(raw);
    if (idx == null || idx < 1 || idx > picks.length) {
        return { state, syntheticUserText: null };
    }

    const pick = picks[idx - 1]!;
    const embId = pick.embalagemId;
    const label = pick.label ?? `opcao ${idx}`;
    return applyPick(embId, label, state);
}
