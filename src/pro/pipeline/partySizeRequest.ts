/**
 * "pizza pra 4 pessoas" → pessoas + dica de produto.
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
    "sugerir",
    "sugere",
    "qual",
    "que",
    "me",
    "voce",
    "voces",
    "tem",
    "vende",
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
    const m = n.match(/\b(?:pra|para|p\/)\s*(\d{1,2})\s*pessoas?\b/u);
    if (!m) return null;
    const people = Number(m[1]);
    if (!Number.isFinite(people) || people < 1 || people > 99) return null;
    const before = n.slice(0, m.index ?? 0).trim();
    const hintTokens = before
        .split(" ")
        .filter((t) => t.length >= 3 && !FILLER.has(t));
    const productHint = hintTokens.length ? hintTokens[hintTokens.length - 1]! : null;
    return { people, productHint };
}
