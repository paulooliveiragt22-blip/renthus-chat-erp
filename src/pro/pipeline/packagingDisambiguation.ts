/**
 * Pós-processo do `search_produtos` no agent loop: quando a busca retorna várias
 * embalagens do MESMO produto (ex.: UN/CX/Fardo de "HEINEKEN"), reaproveita a mesma
 * lógica de sigla comercial + hábito do cliente já validada em `resolveSegmentPick`
 * (usada antes no bootstrap determinístico) para reduzir a ambiguidade sem precisar
 * de uma rodada extra de clarificação com o cliente.
 *
 * Fallback: variantes do mesmo produto com rótulos distintos (ex.: MARMITA P / M / G,
 * todas UN) — casa por `display_name` / `descricao` no texto do cliente ("2 MARMITA P").
 *
 * Ambiguidade entre PRODUTOS diferentes (nomes distintos) não é tocada aqui.
 */
import { enrichSearchTermPackagingFromUserText, packagingScopeForQuery } from "./packagingHint";
import { resolveSegmentPick } from "./resolveSegmentPick";
import type { CompanySigla, CustomerSiglaHabit } from "./customerPackagingHabit";
import { extractQuantityNearQuery } from "@/src/pro/tools/parseQtyPt";

type PackagingRow = {
    id: string;
    display_name?: string | null;
    product_name?: string | null;
    descricao?: string | null;
    sigla_comercial?: string | null;
    preco_venda?: number | string | null;
    fator_conversao?: number | string | null;
    produto_id?: string | null;
    /** Volume/SKU (ex.: LATA 269 vs 600ML) — família UN/CX é por volume, não pelo produto pai. */
    product_volume_id?: string | null;
};

function normalizePt(text: string): string {
    return String(text ?? "")
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ");
}

/**
 * Mesma família de venda (UN/CX do mesmo SKU/volume).
 * Prefere `product_volume_id`: um produto pai (ex.: ORIGINAL) pode ter LATA + 600ML;
 * tratar só por `produto_id` misturava volumes e a qty "5" virava heurística UN em tudo.
 * Fallback: `produto_id`, depois `product_name` (legado quando enrich apaga o nome pai).
 */
export function isSamePackagingFamily(rows: PackagingRow[]): boolean {
    if (rows.length < 2) return false;
    const volIds = [
        ...new Set(rows.map((r) => String(r.product_volume_id ?? "").trim()).filter(Boolean)),
    ];
    if (volIds.length === 1 && volIds[0]) return true;
    /** Se há volumes distintos informados, não é a mesma família UN/CX. */
    if (volIds.length > 1) return false;
    const ids = [...new Set(rows.map((r) => String(r.produto_id ?? "").trim()).filter(Boolean))];
    if (ids.length === 1 && ids[0]) return true;
    const names = new Set(
        rows.map((r) => normalizePt(r.product_name ?? "")).filter((n) => n.length > 0)
    );
    return names.size === 1;
}

function rowLabelTokens(row: PackagingRow): string[] {
    const label = normalizePt(
        [row.display_name, row.product_name, row.descricao].filter(Boolean).join(" ")
    );
    return label.split(" ").filter((t) => t.length >= 1);
}

/** Tokens presentes em TODAS as linhas (marca compartilhada) — não contam como distintivos. */
function commonLabelTokens(rows: readonly PackagingRow[]): Set<string> {
    if (!rows.length) return new Set();
    let common = new Set(rowLabelTokens(rows[0]!));
    for (const r of rows.slice(1)) {
        const toks = new Set(rowLabelTokens(r));
        common = new Set([...common].filter((t) => toks.has(t)));
    }
    return common;
}

/**
 * Estreita o pool quando o texto casa melhor com um subconjunto (ex.: "original lata"
 * → só LATA UN/CX, sem 600ML/TREZENTINHA). Empate no topo = devolve o subconjunto
 * (para depois resolver CX/UN), não `null` que mantinha o pool inteiro.
 */
export function filterRowsByBestLabelMatch<T extends PackagingRow>(
    rows: readonly T[],
    query: string,
    userText: string
): T[] {
    if (rows.length < 2) return [...rows];
    const text = normalizePt(`${query} ${userText}`);
    if (!text) return [...rows];
    const textTokens = new Set(text.split(" ").filter((t) => t.length >= 1));
    const common = commonLabelTokens(rows);
    const scored = rows.map((r) => {
        const nameTokens = rowLabelTokens(r);
        const distinctiveHits = nameTokens.filter(
            (t) => textTokens.has(t) && !common.has(t) && t.length >= 3
        ).length;
        return { row: r, distinctiveHits };
    });
    const max = Math.max(...scored.map((s) => s.distinctiveHits));
    if (max <= 0) return [...rows];
    const top = scored.filter((s) => s.distinctiveHits === max).map((s) => s.row);
    return top.length >= 1 && top.length < rows.length ? top : [...rows];
}

/**
 * Casa variante por rótulo quando sigla comercial não diferencia (todas UN, tamanhos P/M/G).
 * Retorna 1 linha se houver match único; senão `null` (mantém ambiguidade).
 *
 * Prioriza o `query` (rawTerm da line na worklist). O userText completo do turno
 * polui quando o cliente pede dois tamanhos no mesmo msg ("3 marmitas m … e 2 marmitas g"):
 * tokens m+g empatam se misturados cedo demais.
 */
export function matchUniqueVariantByLabel<T extends PackagingRow>(
    rows: readonly T[],
    query: string,
    userText: string
): T | null {
    if (rows.length < 2) return null;
    const q = normalizePt(query);
    if (q) {
        const fromQuery = matchUniqueVariantByLabelAgainstText(rows, q);
        if (fromQuery) return fromQuery;
    }
    const combined = normalizePt(`${query} ${userText}`);
    if (!combined || combined === q) return null;
    return matchUniqueVariantByLabelAgainstText(rows, combined);
}

function matchUniqueVariantByLabelAgainstText<T extends PackagingRow>(
    rows: readonly T[],
    text: string
): T | null {
    if (!text) return null;

    const isPhraseInText = (phrase: string): boolean =>
        text === phrase ||
        text.startsWith(`${phrase} `) ||
        text.endsWith(` ${phrase}`) ||
        text.includes(` ${phrase} `);

    /**
     * 1) Frase completa do display_name no texto ("marmita p" ⊂ "quero 2 marmita p").
     * Prefere o display mais longo; display genérico (= product_name) não fecha se existir
     * irmão com rótulo mais específico (ex.: SALGADINHO vs SALGADINHO CX).
     */
    const phraseCandidates = rows
        .map((r) => ({
            row: r,
            display: normalizePt(r.display_name ?? ""),
            productName: normalizePt(r.product_name ?? ""),
        }))
        .filter((c) => c.display.length >= 2 && isPhraseInText(c.display))
        .sort((a, b) => b.display.length - a.display.length);
    if (phraseCandidates.length) {
        const bestLen = phraseCandidates[0]!.display.length;
        const top = phraseCandidates.filter((c) => c.display.length === bestLen);
        if (top.length === 1) {
            const winner = top[0]!;
            const hasMoreSpecificSibling = rows.some((r) => {
                const d = normalizePt(r.display_name ?? "");
                return d.length > winner.display.length && d.startsWith(`${winner.display} `);
            });
            if (!(winner.display === winner.productName && hasMoreSpecificSibling)) {
                return winner.row;
            }
        }
    }

    /** 2) `descricao` curta (P/M/G) como token isolado no texto, única entre as opções. */
    const descHits = rows.filter((r) => {
        const d = normalizePt(r.descricao ?? "");
        if (!d || d.length > 3) return false;
        const escaped = d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "u");
        return re.test(text);
    });
    if (descHits.length === 1) return descHits[0]!;

    /**
     * 3) Só fecha com token DISTINTIVO além dos tokens comuns a todas as linhas
     * (ex.: "lata" em ORIGINAL LATA vs ORIGINAL 600ML; "p" em MARMITA P).
     */
    const textTokens = new Set(text.split(" ").filter((t) => t.length >= 1));
    const common = commonLabelTokens(rows);
    const scored = rows
        .map((r) => {
            const nameTokens = rowLabelTokens(r);
            const distinctiveHits = nameTokens.filter(
                (t) => textTokens.has(t) && !common.has(t)
            ).length;
            return { row: r, distinctiveHits, nameTokens };
        })
        .filter((s) => s.distinctiveHits > 0)
        .sort((a, b) => b.distinctiveHits - a.distinctiveHits);
    if (!scored.length) return null;
    if (!scored[1] || scored[1]!.distinctiveHits < scored[0]!.distinctiveHits) {
        return scored[0]!.row;
    }

    const shortTokens = [...textTokens].filter((t) => t.length <= 2 && !/^\d+$/u.test(t));
    if (!shortTokens.length) return null;
    const byShort = scored
        .map((s) => ({
            ...s,
            shortHits: shortTokens.filter((t) => s.nameTokens.includes(t)).length,
        }))
        .filter((s) => s.shortHits > 0)
        .sort((a, b) => b.shortHits - a.shortHits || b.distinctiveHits - a.distinctiveHits);
    if (!byShort.length) return null;
    if (byShort[1] && byShort[1]!.shortHits === byShort[0]!.shortHits) return null;
    return byShort[0]!.row;
}

export function disambiguatePackagingForSearchRows<T extends PackagingRow>(
    rows: T[],
    query: string,
    userText: string,
    opts?: {
        companySiglas?: CompanySigla[] | null;
        habitSigla?: CustomerSiglaHabit | null;
    }
): T[] {
    if (rows.length < 2) return rows;

    let working = rows;
    if (!isSamePackagingFamily(working)) {
        const filtered = filterRowsByBestLabelMatch(working, query, userText);
        if (filtered.length < working.length && filtered.length >= 1) {
            working = filtered;
        }
    }

    const qtyHint = extractQuantityNearQuery(query, userText);

    if (isSamePackagingFamily(working)) {
        const segment = enrichSearchTermPackagingFromUserText(query, userText);
        const scopedHint = packagingScopeForQuery(query, userText);
        const resolved = resolveSegmentPick(segment, working, {
            quantity: qtyHint,
            /** Só o segmento do produto — não herdar "caixa" de outro item no turno. */
            formatHintText: scopedHint,
            habitSigla: opts?.habitSigla ?? null,
            companySiglas: opts?.companySiglas ?? null,
        });
        if (resolved.kind === "unique") {
            const match = working.find((r) => r.id === resolved.pick.embalagemId);
            if (match) return [match];
        }
    }

    const byLabel = matchUniqueVariantByLabel(working, query, userText);
    return byLabel ? [byLabel] : working;
}
