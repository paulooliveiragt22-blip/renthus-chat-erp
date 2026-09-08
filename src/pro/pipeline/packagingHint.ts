/** Hint de embalagem sem nome de produto (ex.: "caixa de 15") — helper de busca, não intent. */

import { splitOrderProductSegments } from "@/src/pro/tools/parseQtyPt";

function normalizePt(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ");
}

export function looksLikePackagingOnlyHint(hint: string): boolean {
    const t = normalizePt(hint);
    if (!t) return true;
    if (/^(caixa|cx|fardo|pacote|unidade|un|pack)\b/u.test(t)) return true;
    if (/^caixa\s+de\s+\d+/u.test(t)) return true;
    if (/^\d+\s*(un|unidades|und)?$/u.test(t)) return true;
    return false;
}

const PACKAGING_STOP = new Set([
    "caixa",
    "caixas",
    "cx",
    "fardo",
    "fardos",
    "pack",
    "packs",
    "pacote",
    "pacotes",
    "unidade",
    "unidades",
    "un",
    "lata",
    "long",
    "neck",
    "longneck",
    "garrafa",
    "pet",
    "litros",
    "litro",
]);

/**
 * Se o LLM omitiu "caixa/cx/fardo" no searchTerm mas o texto do cliente
 * associa essa embalagem aos tokens do termo, reinsere no termo de busca.
 * Só olha o **segmento** do produto (mesmo splitter de qty/sigla) — não herda
 * "caixa de jamel" para skol.
 */
export function packagingScopeForQuery(searchTerm: string, userText: string): string {
    const seg = normalizePt(searchTerm);
    if (!seg) return normalizePt(userText);

    const tokens = seg
        .split(" ")
        .filter((t) => t.length >= 3 && !PACKAGING_STOP.has(t) && !/^\d/.test(t));
    const parts = splitOrderProductSegments(userText);
    if (tokens.length && parts.length >= 1) {
        let bestPart: string | null = null;
        let bestScore = 0;
        for (const part of parts) {
            const n = normalizePt(part);
            const score = tokens.filter((t) => n.includes(t)).length;
            if (score > bestScore) {
                bestScore = score;
                bestPart = n;
            }
        }
        if (bestPart && bestScore > 0) return bestPart;
        if (parts.length > 1) return seg;
    }
    return parts.length === 1 ? normalizePt(parts[0]!) : normalizePt(userText) || seg;
}

export function enrichSearchTermPackagingFromUserText(
    searchTerm: string,
    userText: string
): string {
    const seg = normalizePt(searchTerm);
    if (!seg) return searchTerm.trim();
    if (/\b(caixa|caixas|cx|fardo|fardos|pack|packs|pacote|pacotes)\b/u.test(seg)) {
        return searchTerm.trim();
    }
    if (/\b(unidade|unidades|\bun\b)\b/u.test(seg)) return searchTerm.trim();

    const tokens = seg
        .split(" ")
        .filter((t) => t.length >= 3 && !PACKAGING_STOP.has(t) && !/^\d/.test(t));
    if (!tokens.length) return searchTerm.trim();

    const scope = packagingScopeForQuery(searchTerm, userText);
    if (!tokens.every((t) => scope.includes(t))) return searchTerm.trim();

    if (!/\b(caixa|caixas|cx|fardo|fardos|pacote|pack)s?\b/u.test(scope)) {
        return searchTerm.trim();
    }

    const pack = /\b(fardo|fardos)\b/u.test(scope)
        ? "fardo"
        : /\b(pacote|pacotes|pack|packs)\b/u.test(scope)
          ? "pacote"
          : "caixa";
    return `${searchTerm.trim()} ${pack}`.replaceAll(/\s+/g, " ").trim();
}
