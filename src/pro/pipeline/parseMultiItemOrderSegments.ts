/**
 * Quebra pedido multi-item em segmentos para busca/prepare no servidor.
 * Ex.: "quero uma Heineken long neck caixa, um hamburguer e um salgadinho ..."
 */

function normalizePt(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

const LEAD_IN =
    /^(?:ola|oi|bom\s+dia|boa\s+tarde|boa\s+noite)?\s*(?:[,!]?\s*)?(?:quero|queria|manda|pode|preciso|me\s+traz)?\s*(?:tambem|também)?\s*/u;

const NOISE_PHRASES =
    /\b(?:no\s+mesmo\s+endereco(?:\s+de\s+sempre)?|endereco\s+de\s+sempre|pagamento\s+no\s+\w+|pagando\s+(?:no|em)\s+\w+|via\s+(?:pix|cartao|dinheiro))\b/giu;

/**
 * Segmentos de produto a partir de vírgulas / " e " / " um|uma ".
 */
export function parseMultiItemOrderSegments(text: string): string[] {
    let t = normalizePt(text);
    if (!t || t.length < 6) return [];

    t = t.replace(LEAD_IN, "").replace(NOISE_PHRASES, " ").replaceAll(/\s+/g, " ").trim();
    if (!t) return [];

    // Separadores: vírgula, " e ", " mais "
    const rough = t
        .split(/\s*,\s*|\s+e\s+|\s+mais\s+/u)
        .map((s) =>
            s
                .replace(/^(?:tambem|também)\s+/u, "")
                .replace(/^(?:um|uma|uns|umas|o|a|os|as)\s+/u, "")
                .trim()
        )
        .filter((s) => s.length >= 3);

    // Filtra ruído residual
    const out = rough.filter(
        (s) =>
            !/^(pix|cartao|dinheiro|endereco)/u.test(s) &&
            !/pagamento/u.test(s)
    );

    return [...new Set(out)].slice(0, 6);
}
