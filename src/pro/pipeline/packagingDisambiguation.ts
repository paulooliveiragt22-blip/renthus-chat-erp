/**
 * Pós-processo do `search_produtos` no agent loop: quando a busca retorna várias
 * embalagens do MESMO produto (ex.: UN/CX/Fardo de "HEINEKEN"), reaproveita a mesma
 * lógica de sigla comercial + hábito do cliente já validada em `resolveSegmentPick`
 * (usada antes no bootstrap determinístico) para reduzir a ambiguidade sem precisar
 * de uma rodada extra de clarificação com o cliente.
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

/** Todas as linhas são embalagens do mesmo produto (candidatas a desambiguação de sigla). */
export function isSamePackagingFamily(rows: PackagingRow[]): boolean {
    if (rows.length < 2) return false;
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

export function disambiguatePackagingForSearchRows<T extends PackagingRow>(
    rows: T[],
    query: string,
    userText: string,
    opts?: {
        companySiglas?: CompanySigla[] | null;
        habitSigla?: CustomerSiglaHabit | null;
    }
): T[] {
    if (!isSamePackagingFamily(rows)) return rows;

    const segment = enrichSearchTermPackagingFromUserText(query, userText);
    const resolved = resolveSegmentPick(segment, rows, {
        quantity: extractQuantityHintFromUserText(userText),
        formatHintText: userText,
        habitSigla: opts?.habitSigla ?? null,
        companySiglas: opts?.companySiglas ?? null,
    });
    if (resolved.kind !== "unique") return rows;

    const match = rows.find((r) => r.id === resolved.pick.embalagemId);
    return match ? [match] : rows;
}
