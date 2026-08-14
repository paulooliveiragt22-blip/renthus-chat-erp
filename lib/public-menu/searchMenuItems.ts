/**
 * Filtro fuzzy do cardápio web no catálogo já carregado.
 * Haystack = mesmo nome da tela (`PublicMenuItem.name` / buildPackDisplayName)
 * + descrição, categoria e sigla.
 */

import { formatPackSiglaLabel } from "@/lib/products/packDisplayName";
import {
    expandSearchVariants,
    normalizeSearchKey,
    scoreDidYouMean,
} from "@/lib/products/searchNormalize";
import type { PublicMenuCategory, PublicMenuItem } from "@/src/types/contracts.public-menu";

/** Alinhado ao rerank do chatbot (`scoreDidYouMean` + Levenshtein ≥ 0.55). */
export const PUBLIC_MENU_SEARCH_MIN_SCORE = 0.55;

export function publicMenuItemHaystack(item: PublicMenuItem): string {
    return [
        item.name,
        item.description,
        item.categoryName,
        formatPackSiglaLabel(item.sigla, item.fatorConversao),
    ]
        .filter((p) => Boolean(p && String(p).trim()))
        .join(" ");
}

export function scorePublicMenuItem(query: string, item: PublicMenuItem): number {
    const variants = expandSearchVariants(query);
    const keys = variants.length > 0 ? variants : [normalizeSearchKey(query)];
    const name = item.name;
    const hay = publicMenuItemHaystack(item);
    let best = 0;
    for (const v of keys) {
        best = Math.max(best, scoreDidYouMean(v, name), scoreDidYouMean(v, hay));
        if (best >= 0.9) return best;
    }
    return best;
}

export function filterPublicMenuItems(items: PublicMenuItem[], query: string): PublicMenuItem[] {
    const q = normalizeSearchKey(query);
    if (q.length < 2) return items;
    return items
        .map((item) => ({ item, score: scorePublicMenuItem(query, item) }))
        .filter((row) => row.score >= PUBLIC_MENU_SEARCH_MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .map((row) => row.item);
}

export function filterPublicMenuCategories(
    categories: PublicMenuCategory[],
    query: string
): PublicMenuCategory[] {
    const q = normalizeSearchKey(query);
    if (q.length < 2) return categories;
    return categories
        .map((cat) => ({
            ...cat,
            items: filterPublicMenuItems(cat.items, query),
        }))
        .filter((cat) => cat.items.length > 0);
}
