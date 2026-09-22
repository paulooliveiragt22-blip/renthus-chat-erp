/**
 * Tenta separar rua, número e bairro a partir de uma linha única (ex.: "Rua tangará 850 São Mateus").
 * Heurística conservadora: último grupo de dígitos como número da porta; o que vem antes = logradouro; depois = bairro.
 * Cidade/UF não são exigidos do cliente — o servidor completa com a loja + ViaCEP.
 */
export function tryParseAddressOneLine(raw: string): {
    logradouro: string;
    numero:     string;
    bairro:     string;
} | null {
    const t = raw
        .replaceAll(/,/gu, " ")
        .replaceAll(/\s+/gu, " ")
        .trim();
    if (t.length < 6) return null;

    // "Rua X 850 Bairro Nome" — número com 1 a 6 dígitos opcional letra (850A)
    const m = t.match(/^(.+?)\s+(\d{1,6}[a-zA-Z]?)\s+(.+)$/u);
    if (!m) return null;

    const logradouro = m[1].trim().replace(/^(aqui\s+na|na|no|em)\s+/iu, "").trim();
    const numero     = m[2].trim();
    const bairro     = m[3].trim();

    if (logradouro.length < 2 || bairro.length < 2) return null;
    if (!/\d/u.test(numero)) return null;

    return { logradouro, numero, bairro };
}

/** Onde o endereço começa dentro de uma frase que também tem itens. */
const ADDRESS_START_RE =
    /\b(?:aqui\s+n[ao]s?|aqui\s+em|na\s+rua|no\s+bairro|rua|avenida|av\.?|alameda|travessa|estrada|rodovia)\b/iu;

/** Cauda de pagamento depois do endereço ("... 1627 Industrial pagamento no pix"). */
const PAYMENT_TAIL_RE =
    /\b(?:pagamento|pagar|pago|pix|cart[aã]o|dinheiro|cr[eé]dito|d[eé]bito|esp[eé]cie)\b.*$/iu;

/**
 * Recorta o trecho de endereço de uma mensagem que mistura itens, endereço e pagamento
 * ("manda 2 caixas de X aqui na Rua das Turmalinas, 1627 Industrial pagamento no pix").
 * Devolve `null` quando o recorte não forma um endereço utilizável — o servidor não
 * inventa endereço a partir de texto solto.
 */
export function extractAddressLineFromText(text: string): string | null {
    const raw = String(text ?? "").trim();
    if (!raw) return null;
    const start = ADDRESS_START_RE.exec(raw);
    if (!start) return null;
    const slice = raw
        .slice(start.index)
        .replace(PAYMENT_TAIL_RE, "")
        .trim()
        .replace(/[.,;\s]+$/u, "");
    if (!slice) return null;
    return tryParseAddressOneLine(slice) ? slice : null;
}
