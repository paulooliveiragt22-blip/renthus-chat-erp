/** Hint de embalagem sem nome de produto (ex.: "caixa de 15") — helper de busca, não intent. */

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
 * Não interpreta itens — só packaging já dito pelo cliente.
 */
export function enrichSearchTermPackagingFromUserText(
    searchTerm: string,
    userText: string
): string {
    const seg = normalizePt(searchTerm);
    const u = normalizePt(userText);
    if (!seg || !u) return searchTerm.trim();
    if (/\b(caixa|caixas|cx|fardo|fardos|pack|packs|pacote|pacotes)\b/u.test(seg)) {
        return searchTerm.trim();
    }
    if (/\b(unidade|unidades|\bun\b)\b/u.test(seg)) return searchTerm.trim();

    const tokens = seg
        .split(" ")
        .filter((t) => t.length >= 3 && !PACKAGING_STOP.has(t) && !/^\d/.test(t));
    if (!tokens.length) return searchTerm.trim();
    if (!tokens.every((t) => u.includes(t))) return searchTerm.trim();

    /** Janelas locais ao redor de embalagem (corta em " e " / " mais " / vírgula). */
    const windows: string[] = [];
    for (const m of u.matchAll(
        /\b(caixa|caixas|cx|fardo|fardos|pacote|pack)s?\b(?:\s+de)?\s+(.+?)(?=\s+e\s+|\s+mais\s+|,|$)/gu
    )) {
        windows.push(String(m[2] ?? "").slice(0, 48).trim());
    }
    for (const m of u.matchAll(
        /([a-z0-9][a-z0-9\s]{0,40}?)\s+\b(caixa|caixas|cx|fardo|fardos|pacote|pack)s?\b/gu
    )) {
        windows.push(String(m[1] ?? "").trim());
    }
    const inLocalWindow = windows.some((w) => tokens.every((t) => w.includes(t)));
    if (!inLocalWindow) return searchTerm.trim();

    const pack = /\b(fardo|fardos)\b/u.test(u)
        ? "fardo"
        : /\b(pacote|pacotes|pack|packs)\b/u.test(u)
          ? "pacote"
          : "caixa";
    return `${searchTerm.trim()} ${pack}`.replaceAll(/\s+/g, " ").trim();
}
