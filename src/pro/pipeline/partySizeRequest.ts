/**
 * "pizza pra 4 pessoas" e "marmita que serve 3 pessoas" → pessoas + dica de produto.
 * "quero 4 skol" não é porção: falta "pessoas".
 */

const FILLER = new Set([
    "um",
    "uma",
    "o",
    "a",
    "de",
    "da",
    "do",
    "pra",
    "para",
    "quero",
    "queria",
    "recomenda",
    "recomendacao",
    "recomende",
    "indicar",
    "indica",
    "indique",
    "indicacao",
    "sugerir",
    "sugere",
    "sugestao",
    "qual",
    "que",
    "me",
    "voce",
    "voces",
    "tem",
    "vende",
    "boa",
    "melhor",
    "ideal",
]);

function normalize(text: string): string {
    return text
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

export type PartySizeRequest = {
    people: number;
    /** Palavra de produto antes da porção ("pizza"). Vazio = qualquer item com serve_ate. */
    productHint: string | null;
};

export function extractPartySizeRequest(text: string): PartySizeRequest | null {
    const raw = String(text ?? "").trim();
    if (!raw || raw.length > 120) return null;
    const n = normalize(raw);
    // pessoas, pessoa e o typo pessosas / pessosa (s a mais).
    const m = n.match(/\b(?:pra|para|p\/|serve(?:\s+ate)?)\s*(\d{1,2})\s*pess+o+s*a+s*\b/u);
    if (!m) return null;
    const people = Number(m[1]);
    if (!Number.isFinite(people) || people < 1 || people > 99) return null;
    const before = n.slice(0, m.index ?? 0).trim();
    const after = n.slice((m.index ?? 0) + m[0].length).trim();
    const content = (chunk: string) =>
        chunk.split(" ").filter((t) => t.length >= 3 && !FILLER.has(t));
    const beforeTokens = content(before);
    const afterTokens = content(after);
    const productHint = beforeTokens.length
        ? beforeTokens[beforeTokens.length - 1]!
        : (afterTokens[0] ?? null);
    return { people, productHint };
}
