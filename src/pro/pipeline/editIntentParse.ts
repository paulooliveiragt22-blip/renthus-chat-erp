/**
 * Intenções de edição de carrinho (troca/substitui) — parsing determinístico PT-BR.
 */

export type CheckoutSwapIntent = {
    /** Nome/trecho do item a remover do draft (ex.: "salgadinho"). */
    removeName: string;
    /** Query canônica para search_produtos (produto + embalagem). */
    searchQuery: string;
    /** Trecho do substituto como o cliente escreveu. */
    replaceHint: string;
};

function normalizePt(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ");
}

/** "caixa de 15", "cx", "fardo" — sem nome de produto. */
export function looksLikePackagingOnlyHint(hint: string): boolean {
    const t = normalizePt(hint);
    if (!t) return true;
    if (/^(caixa|cx|fardo|pacote|unidade|un|pack)\b/u.test(t)) return true;
    if (/^caixa\s+de\s+\d+/u.test(t)) return true;
    if (/^\d+\s*(un|unidades|und)?$/u.test(t)) return true;
    return false;
}

/**
 * Ex.: "troca o salgadinho pela caixa de 15" →
 * removeName=salgadinho, searchQuery="salgadinho caixa de 15"
 */
export function parseCheckoutSwapIntent(text: string): CheckoutSwapIntent | null {
    const t = normalizePt(text);
    if (!t || t.length < 8) return null;

    const m = t.match(
        /^(?:troca(?:r)?|substitui(?:r)?)\s+(?:o|a|os|as)?\s*(.+?)\s+(?:pela|pelo|por)\s+(.+)$/u
    );
    if (!m) return null;

    const removeName = (m[1] ?? "").trim();
    const replaceHint = (m[2] ?? "").trim();
    if (!removeName || !replaceHint) return null;
    if (removeName.length < 3 || replaceHint.length < 2) return null;

    const searchQuery = looksLikePackagingOnlyHint(replaceHint)
        ? `${removeName} ${replaceHint}`.replaceAll(/\s+/g, " ").trim()
        : replaceHint.includes(removeName.split(" ")[0]!)
          ? replaceHint
          : `${removeName} ${replaceHint}`.replaceAll(/\s+/g, " ").trim();

    return { removeName, searchQuery, replaceHint };
}
