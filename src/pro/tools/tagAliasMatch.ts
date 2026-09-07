/**
 * Apelidos cadastrados em `produto_embalagens.tags` (ex.: "caixinha", "fardinho").
 * Filtra hits quando o texto do cliente casa com token de tag — risco mínimo de
 * pedido errado: só restringe o conjunto; se nada casar, mantém a lista original.
 */

import { normalizeSearchKey } from "@/lib/products/searchNormalize";

const STOP = new Set([
    "quero",
    "manda",
    "pedir",
    "pedido",
    "para",
    "pra",
    "com",
    "uma",
    "umas",
    "uns",
    "dois",
    "duas",
    "tres",
    "quatro",
    "cinco",
    "caixa",
    "caixas",
    "unidade",
    "unidades",
    "fardo",
    "fardos",
    "pacote",
    "pacotes",
    "pack",
    "packs",
    "de",
    "da",
    "do",
    "no",
    "na",
]);

function stemToken(t: string): string[] {
    const out = new Set<string>([t]);
    if (t.length > 5 && t.endsWith("es")) out.add(t.slice(0, -2));
    if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) out.add(t.slice(0, -1));
    return [...out].filter((x) => x.length >= 4);
}

/** Tokens do pedido (com singular) — exclui stopwords e números. */
export function queryAliasTokens(text: string): string[] {
    const n = normalizeSearchKey(text);
    if (!n) return [];
    const out = new Set<string>();
    for (const raw of n.split(" ").filter(Boolean)) {
        if (STOP.has(raw) || /^\d+$/u.test(raw)) continue;
        for (const s of stemToken(raw)) out.add(s);
    }
    return [...out];
}

/**
 * Tokens de tags manuais (`produto_embalagens.tags`).
 * Não usa `tags_auto`: ele espelha nome/volume e polui marca vs apelido
 * (ex.: "ORIGINAL … caixinha" fazia `original` parecer tag, não marca).
 */
export function rowTagTokens(tags?: string | null, _tagsAuto?: string | null): string[] {
    const hay = normalizeSearchKey(String(tags ?? ""));
    if (!hay) return [];
    return hay
        .split(/[\s,;/|]+/u)
        .map((t) => t.trim())
        .filter((t) => t.length >= 4 && !STOP.has(t));
}

function tokenHitsTag(queryTok: string, tagTok: string): boolean {
    if (queryTok === tagTok) return true;
    // Prefixos longos: "caixinh" ⊂ "caixinha" (typo leve) — exige ≥5 chars
    if (queryTok.length >= 5 && tagTok.startsWith(queryTok)) return true;
    if (tagTok.length >= 5 && queryTok.startsWith(tagTok)) return true;
    return false;
}

function rowHasTagAlias(tagsRaw: string | null | undefined, queryTok: string): boolean {
    const hay = normalizeSearchKey(String(tagsRaw ?? ""));
    if (!hay || queryTok.length < 4) return false;
    if (hay.includes(queryTok)) return true;
    return rowTagTokens(tagsRaw).some((tt) => tokenHitsTag(queryTok, tt));
}

export type TagAliasRow = {
    id?: string;
    product_name?: string | null;
    display_name?: string | null;
    descricao?: string | null;
    tags?: string | null;
    tags_auto?: string | null;
};

/**
 * Se o cliente usou um apelido presente em tags:
 * - com marca no texto → só embalagens cuja tag casa E o nome casa com a marca
 * - sem marca → só embalagens cuja tag casa (ex.: "me manda uma caixinha")
 * Se nada casa → devolve `rows` intacto (não piora o fluxo atual).
 */
export function preferRowsMatchingTagAliases<T extends TagAliasRow>(
    rows: readonly T[],
    query: string,
    userText?: string | null
): T[] {
    if (rows.length < 2) return [...rows];
    const qTokens = queryAliasTokens(`${query} ${userText ?? ""}`);
    if (!qTokens.length) return [...rows];

    type Scored = { row: T; tagHit: boolean; brandHit: boolean };
    const scored: Scored[] = rows.map((row) => {
        const tagToks = rowTagTokens(row.tags);
        const name = normalizeSearchKey(
            [row.product_name, row.display_name, row.descricao].filter(Boolean).join(" ")
        );
        const tagHit = qTokens.some((qt) => rowHasTagAlias(row.tags, qt));
        /** Token do pedido que NÃO é tag desta linha, mas aparece no nome = marca. */
        const brandHit = qTokens.some(
            (qt) => name.includes(qt) && !tagToks.some((tt) => tokenHitsTag(qt, tt))
        );
        return { row, tagHit, brandHit };
    });

    const tagHits = scored.filter((s) => s.tagHit);
    if (!tagHits.length) return [...rows];

    const combo = tagHits.filter((s) => s.brandHit);
    if (combo.length >= 1) return combo.map((s) => s.row);

    /** Pedido trouxe marca (token em algum nome do pool) mas nenhuma tag+marca: não estreita. */
    const queryHasBrandInPool = scored.some((s) => s.brandHit);
    if (queryHasBrandInPool) return [...rows];

    return tagHits.map((s) => s.row);
}
