/**
 * Tenta separar rua, número e bairro a partir de uma linha única (ex.: "Rua tangará 850 São Mateus").
 * Heurística conservadora: último grupo de dígitos como número da porta; o que vem antes = logradouro; depois = bairro.
 */
export function tryParseAddressOneLine(raw: string): {
    logradouro: string;
    numero:     string;
    bairro:     string;
} | null {
    const t = raw.replace(/\s+/gu, " ").trim();
    if (t.length < 6) return null;

    // "Rua X 850 Bairro Nome" — número com 1 a 6 dígitos opcional letra (850A)
    const m = t.match(/^(.+?)\s+(\d{1,6}[a-zA-Z]?)\s+(.+)$/u);
    if (!m) return null;

    const logradouro = m[1].trim();
    const numero     = m[2].trim();
    const bairro     = m[3].trim();

    if (logradouro.length < 2 || bairro.length < 2) return null;
    if (!/\d/u.test(numero)) return null;

    return { logradouro, numero, bairro };
}
