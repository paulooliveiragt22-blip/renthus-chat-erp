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
import { enrichSearchTermPackagingFromUserText } from "./packagingHint";
import { resolveSegmentPick } from "./resolveSegmentPick";
import type { CompanySigla, CustomerSiglaHabit } from "./customerPackagingHabit";
import { parsePtQuantity } from "@/src/pro/tools/parseQtyPt";

type PackagingRow = {
    id: string;
    display_name?: string | null;
    product_name?: string | null;
    descricao?: string | null;
    sigla_comercial?: string | null;
    preco_venda?: number | string | null;
    fator_conversao?: number | string | null;
    produto_id?: string | null;
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
 * Mesma família de venda (UN/CX do mesmo SKU).
 * Prefere `produto_id`: após `enrichAndFilter` o `product_name` vira `display_name`
 * (MARMITA P vs G vs M) e o nome pai some — sem isso a desambiguação nunca rodava.
 */
export function isSamePackagingFamily(rows: PackagingRow[]): boolean {
    if (rows.length < 2) return false;
    const ids = [...new Set(rows.map((r) => String(r.produto_id ?? "").trim()).filter(Boolean))];
    if (ids.length === 1 && ids[0]) return true;
    const names = new Set(
        rows.map((r) => normalizePt(r.product_name ?? "")).filter((n) => n.length > 0)
    );
    return names.size === 1;
}

/**
 * Extrai uma quantidade mencionada no texto do cliente (dígito ou número por extenso),
 * pra alimentar a heurística "quantidade menor que o fator da caixa → assume UN" em
 * `resolveSegmentPick`. Sem isso, essa heurística só disparava no caso especial de
 * "long neck" — não de forma genérica pra qualquer produto (ex.: "2 skol lata").
 */
function extractQuantityHintFromUserText(userText: string): number | null {
    const digitMatch = String(userText ?? "").match(/\b(\d{1,3})\b/u);
    if (digitMatch) {
        const n = Number(digitMatch[1]);
        if (Number.isFinite(n) && n >= 1) return n;
    }
    for (const tok of normalizePt(userText).split(" ").filter(Boolean)) {
        const v = parsePtQuantity(tok);
        if (v != null) return v;
    }
    return null;
}

function rowLabelTokens(row: PackagingRow): string[] {
    const label = normalizePt(
        [row.display_name, row.product_name, row.descricao].filter(Boolean).join(" ")
    );
    return label.split(" ").filter((t) => t.length >= 1);
}

/**
 * Casa variante por rótulo quando sigla comercial não diferencia (todas UN, tamanhos P/M/G).
 * Retorna 1 linha se houver match único; senão `null` (mantém ambiguidade).
 */
export function matchUniqueVariantByLabel<T extends PackagingRow>(
    rows: readonly T[],
    query: string,
    userText: string
): T | null {
    if (rows.length < 2) return null;
    const text = normalizePt(`${query} ${userText}`);
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
     * 3) Só fecha com token DISTINTIVO além do product_name compartilhado
     * (ex.: "p" em MARMITA P). Hit só no nome genérico → ambiguidade.
     */
    const textTokens = new Set(text.split(" ").filter((t) => t.length >= 1));
    const productTokens = new Set(
        normalizePt(rows[0]?.product_name ?? "")
            .split(" ")
            .filter((t) => t.length >= 1)
    );
    const scored = rows
        .map((r) => {
            const nameTokens = rowLabelTokens(r);
            const distinctiveHits = nameTokens.filter(
                (t) => textTokens.has(t) && !productTokens.has(t)
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

    if (isSamePackagingFamily(rows)) {
        const segment = enrichSearchTermPackagingFromUserText(query, userText);
        const resolved = resolveSegmentPick(segment, rows, {
            quantity: extractQuantityHintFromUserText(userText),
            formatHintText: userText,
            habitSigla: opts?.habitSigla ?? null,
            companySiglas: opts?.companySiglas ?? null,
        });
        if (resolved.kind === "unique") {
            const match = rows.find((r) => r.id === resolved.pick.embalagemId);
            if (match) return [match];
        }
    }

    const byLabel = matchUniqueVariantByLabel(rows, query, userText);
    return byLabel ? [byLabel] : rows;
}
