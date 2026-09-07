/**
 * Apelidos manuais em `produto_embalagens.tags` (ex.: "caixinha", "buchudinha").
 *
 * Modelo (dono):
 * - Tag = apelido **daquela embalagem** (SKU), não sinônimo global de UN/CX.
 * - Mesma tag em UN+CX → estreitar pela **sigla falada** (caixa→CX).
 * - Tag só na UN + cliente pediu caixa → promover CX **irmã** (mesmo
 *   `product_volume_id`, senão mesmo `produto_id`) presente no pool de busca.
 * - Tag só na CX (ex.: caixinha) → o hit da tag já escolhe o SKU; várias marcas
 *   com a mesma tag → estreitar por **nome/marca**.
 * - Sem sigla falada e ≥2 hits → não inventar; clarificar upstream.
 *
 * Não usa `tags_auto` (espelha nome/volume e polui marca vs apelido).
 */

import { normalizeSearchKey } from "@/lib/products/searchNormalize";

/** Stopwords de qty / forma de venda canônica — NÃO incluir apelidos de tag (caixinha). */
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

/**
 * Sigla comercial explícita no texto do cliente.
 * Intencionalmente NÃO mapeia "caixinha"/"fardinho" → CX/FARD (isso é tag de catálogo).
 */
export function explicitCommercialSiglaFromText(text: string): string | null {
    const n = normalizeSearchKey(text);
    if (!n) return null;
    if (/\b(caixa|caixas|\bcx\b)\b/u.test(n)) return "CX";
    if (/\b(unidade|unidades|\bun\b)\b/u.test(n)) return "UN";
    if (/\b(fardo|fardos|\bfard\b)\b/u.test(n)) return "FARD";
    if (/\b(pacote|pacotes|pack|packs|\bpac\b)\b/u.test(n)) return "PAC";
    return null;
}

/**
 * Sigla falada no segmento ligado ao termo de busca (multi-produto seguro).
 * Espelha a ideia de `extractQuantityNearQuery`.
 * Com vários segmentos ("A e B"), só usa o pedaço que casa com o query — não o texto inteiro.
 */
export function explicitCommercialSiglaNearQuery(
    query: string,
    userText: string
): string | null {
    const qTokens = normalizeSearchKey(query)
        .split(/\s+/u)
        .filter((t) => t.length >= 3 && !/^\d+$/u.test(t) && !STOP.has(t));
    const u = normalizeSearchKey(userText);
    if (!u) return null;

    const parts = u
        .split(/\s+e\s+|\s+mais\s+|,/u)
        .map((p) => p.trim())
        .filter(Boolean);

    if (qTokens.length && parts.length) {
        let best: string | null = null;
        let bestScore = 0;
        for (const part of parts) {
            const score = qTokens.filter((t) => part.includes(t)).length;
            if (score > bestScore) {
                bestScore = score;
                best = part;
            }
        }
        if (best && bestScore > 0) {
            return explicitCommercialSiglaFromText(best);
        }
        // Multi-item sem overlap com o query: não herdar "caixa" do outro produto.
        if (parts.length > 1) return null;
    }
    return explicitCommercialSiglaFromText(u);
}

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
 * Não usa `tags_auto`.
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

function rowSigla(row: { sigla_comercial?: string | null }): string {
    return String(row.sigla_comercial ?? "")
        .trim()
        .toUpperCase();
}

export type TagAliasRow = {
    id?: string;
    product_name?: string | null;
    display_name?: string | null;
    descricao?: string | null;
    tags?: string | null;
    tags_auto?: string | null;
    /** Forma de venda (UN/CX/…) — usada quando o cliente falou a sigla. */
    sigla_comercial?: string | null;
    product_volume_id?: string | null;
    produto_id?: string | null;
};

type Scored<T> = { row: T; tagHit: boolean; brandHit: boolean };

/**
 * Tag bateu em UN mas o cliente pediu CX (ou o inverso): sobe para irmãos no pool
 * com a sigla pedida (mesmo volume, senão mesmo produto).
 */
export function promoteTagHitsToRequestedSiglaSiblings<T extends TagAliasRow>(
    pool: readonly T[],
    tagHitRows: readonly T[],
    wantSigla: string
): T[] {
    const want = wantSigla.trim().toUpperCase();
    if (!want || !tagHitRows.length) return [...tagHitRows];

    const already = tagHitRows.filter((r) => rowSigla(r) === want);
    if (already.length >= 1) return already;

    const volumeIds = new Set(
        tagHitRows.map((r) => String(r.product_volume_id ?? "").trim()).filter(Boolean)
    );
    const productIds = new Set(
        tagHitRows.map((r) => String(r.produto_id ?? "").trim()).filter(Boolean)
    );

    const byVolume = pool.filter((r) => {
        if (rowSigla(r) !== want) return false;
        const vol = String(r.product_volume_id ?? "").trim();
        return Boolean(vol && volumeIds.has(vol));
    });
    if (byVolume.length >= 1) return byVolume;

    const byProduct = pool.filter((r) => {
        if (rowSigla(r) !== want) return false;
        const pid = String(r.produto_id ?? "").trim();
        return Boolean(pid && productIds.has(pid));
    });
    if (byProduct.length >= 1) return byProduct;

    return [...tagHitRows];
}

/**
 * Se o cliente usou um apelido presente em tags:
 * 1) tag hit (+ marca no texto quando o pool tem marcas distintas)
 * 2) sigla falada → filtra / promove irmão UN↔CX no pool
 * Se nada casa → devolve `rows` intacto.
 */
export function preferRowsMatchingTagAliases<T extends TagAliasRow>(
    rows: readonly T[],
    query: string,
    userText?: string | null
): T[] {
    if (!rows.length) return [];
    const fullText = `${query} ${userText ?? ""}`;
    const qTokens = queryAliasTokens(fullText);
    if (!qTokens.length) return [...rows];

    const scored: Scored<T>[] = rows.map((row) => {
        const tagToks = rowTagTokens(row.tags);
        const name = normalizeSearchKey(
            [row.product_name, row.display_name, row.descricao].filter(Boolean).join(" ")
        );
        const tagHit = qTokens.some((qt) => rowHasTagAlias(row.tags, qt));
        const brandHit = qTokens.some(
            (qt) => name.includes(qt) && !tagToks.some((tt) => tokenHitsTag(qt, tt))
        );
        return { row, tagHit, brandHit };
    });

    const tagHits = scored.filter((s) => s.tagHit);
    if (!tagHits.length) return [...rows];

    let narrowed = tagHits;
    const combo = tagHits.filter((s) => s.brandHit);
    if (combo.length >= 1) {
        narrowed = combo;
    } else if (rows.length >= 2) {
        const queryHasBrandInPool = scored.some((s) => s.brandHit);
        if (queryHasBrandInPool) return [...rows];
    }

    const wantSigla =
        explicitCommercialSiglaNearQuery(query, userText ?? query) ??
        explicitCommercialSiglaFromText(fullText);
    if (wantSigla) {
        return promoteTagHitsToRequestedSiglaSiblings(
            rows,
            narrowed.map((s) => s.row),
            wantSigla
        );
    }

    return narrowed.map((s) => s.row);
}
