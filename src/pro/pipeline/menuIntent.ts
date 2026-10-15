const HUMAN_RE = /\b(?:atendente|humano|suporte|falar\s+com)\b/iu;

function normalize(raw: string): string {
    return raw
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "");
}

/**
 * O cliente quer ver o cardápio, em qualquer frase.
 * O objeto é cardápio/catálogo/menu — não uma lista de verbos.
 */
export function messageAsksForMenu(raw: string): boolean {
    const norm = normalize(raw);
    if (norm === "btn_catalog") return true;
    if (/^(quero\s+)?(ver\s+)?(o\s+)?(cardapio|catalogo|menu)(\s+por\s+favor)?$/u.test(norm)) {
        return true;
    }
    return /\b(?:cardapio|catalogo|menu)\b/u.test(norm);
}

/**
 * Resposta de pick ou quantidade ("2", "uma caixa"). O resto da frase vai ao classificador.
 */
export function isOrderContinuationUtterance(raw: string): boolean {
    const norm = normalize(raw);
    if (/^\d{1,2}$/u.test(norm)) return true;
    const words = norm.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 3) return false;
    return /^(?:\d+|um|uma|dois|duas|tres|quatro|cinco|seis)\b/u.test(norm);
}

/** Cardápio ou atendente não podem ser reescritos como escolha de embalagem. */
export function inboundInterruptsOpenPick(raw: string): boolean {
    return messageAsksForMenu(raw) || HUMAN_RE.test(raw);
}
