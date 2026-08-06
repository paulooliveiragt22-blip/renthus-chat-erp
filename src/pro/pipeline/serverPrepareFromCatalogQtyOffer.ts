import type { ProSessionState } from "@/src/types/contracts";
import { parsePtQuantity } from "@/src/pro/tools/parseQtyPt";

/**
 * Resposta só com quantidade após o bot oferecer um SKU (FAQ “tem X?” → preço → “3”).
 * Ex.: "3", "3 unidades", "tres", "quero 2".
 */
export function parseBareQuantityReply(text: string): number | null {
    const raw = String(text ?? "").trim();
    if (!raw || raw.length > 40) return null;

    const n = raw
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .replaceAll(/\s+/g, " ")
        .trim();

    const cleaned = n
        .replace(/^(?:quero\s+|me\s+ve\s+|manda\s+)?(?:so\s+)?/u, "")
        .replace(/\s*(?:unidades?|unds?|uns?|x)\s*$/u, "")
        .trim();

    if (!cleaned) return null;

    /** Só dígitos ou uma palavra de quantidade — rejeita “3 coca”, “exatamente”, etc. */
    if (/^\d{1,3}$/u.test(cleaned)) {
        return parsePtQuantity(cleaned);
    }

    if (
        /^(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|treze|catorze|quatorze|quinze|vinte)$/u.test(
            cleaned
        )
    ) {
        return parsePtQuantity(cleaned);
    }

    return null;
}

/**
 * SKU único já oferecido na sessão (último search com 1 opção).
 * Não usa quando há clarificação UN/CX (≥2 picks).
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
    if ((state.draft?.items?.length ?? 0) > 0) return false;
    if ((state.lastSearchPicks?.length ?? 0) >= 2) return false;
    if (resolveSingleOfferedEmbalagemId(state) == null) return false;
    return true;
}
