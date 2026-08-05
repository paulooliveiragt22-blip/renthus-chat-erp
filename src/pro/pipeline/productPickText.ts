/**
 * Seleção determinística de embalagem: botão `pro_pick_emb:` ou texto "opção 2" / "2".
 */

import type { ProSessionState } from "@/src/types/contracts";

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
        return {
            state: {
                ...state,
                step: state.step === "pro_idle" ? "pro_collecting_order" : state.step,
                searchProdutoEmbalagemIds: [embId],
                lastSearchPicks: [],
            },
            syntheticUserText: `Quero ${label}. Use produto_embalagem_id=${embId} em prepare_order_draft com quantity 1 (ou a quantidade que eu ja pedi).`,
        };
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
    return {
        state: {
            ...state,
            step: state.step === "pro_idle" ? "pro_collecting_order" : state.step,
            searchProdutoEmbalagemIds: [embId],
            lastSearchPicks: [],
        },
        syntheticUserText: `Quero ${label}. Use produto_embalagem_id=${embId} em prepare_order_draft com quantity 1 (ou a quantidade que eu ja pedi).`,
    };
}
