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
