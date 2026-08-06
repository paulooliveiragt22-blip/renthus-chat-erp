import type { ProSessionState } from "@/src/types/contracts";

/**
 * SKU único já oferecido na sessão (último search com 1 opção).
 * Usado pelo executor de diálogo LLM — não interpreta linguagem.
 */
export function resolveSingleOfferedEmbalagemId(state: ProSessionState): string | null {
    const picks = state.lastSearchPicks ?? [];
    if (picks.length >= 2) return null;
    if (picks.length === 1) {
        const id = String(picks[0]?.embalagemId ?? "").trim();
        return id || null;
    }
    const ids = (state.searchProdutoEmbalagemIds ?? [])
        .map((id) => String(id ?? "").trim())
        .filter(Boolean);
    if (ids.length === 1) return ids[0] ?? null;
    return null;
}

export function canServerPrepareFromCatalogQtyOffer(state: ProSessionState): boolean {
    if ((state.lastSearchPicks?.length ?? 0) >= 2) return false;
    if (resolveSingleOfferedEmbalagemId(state) == null) return false;
    return true;
}

export function isAdditiveCatalogQtyOffer(state: ProSessionState): boolean {
    return (state.draft?.items?.length ?? 0) > 0;
}
