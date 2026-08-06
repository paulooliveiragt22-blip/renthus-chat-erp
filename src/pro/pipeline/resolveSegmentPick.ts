/**
 * Resolve um segmento de pedido ("heineken long neck caixa") contra hits de busca.
 */

import type { PackagingHabit } from "./customerPackagingHabit";

export type SegmentPickRow = {
    embalagemId: string;
    label: string;
    price?: number | null;
    /** Nome canónico do produto no catálogo (hint ao cliente). */
    productName?: string | null;
};

export type ResolveSegmentPickOpts = {
    /** Qty pedida (extração LLM) — qty < fator da CX → prefere UN. */
    quantity?: number | null;
    /** Hábito do cliente neste produto (histórico finalized/delivered). */
    habit?: PackagingHabit | null;
};

function norm(text: string): string {
    return String(text ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/\s+/g, " ")
        .trim();
}

function rowToPick(r: {
    id: string;
    display_name?: string | null;
    product_name?: string | null;
    preco_venda?: number | string | null;
}): SegmentPickRow {
    return {
        embalagemId: String(r.id),
        label: String(r.display_name || r.product_name || "Item").slice(0, 40),
        price: Number.isFinite(Number(r.preco_venda)) ? Number(r.preco_venda) : null,
        productName: String(r.product_name ?? "").trim() || null,
    };
}

export function prefersCase(segment: string): boolean {
    return /\b(caixa|cx|fardo|pack)\b/u.test(norm(segment));
}

/** Pediu unidade / long neck sem "caixa" → não oferecer CX. */
export function prefersUnit(segment: string): boolean {
    const s = norm(segment);
    if (prefersCase(s)) return false;
    if (/\b(unidade|unidades|\bun\b)\b/u.test(s)) return true;
    if (/\blong\s*neck|longneck\b/u.test(s)) return true;
    return false;
}

function isCasePack(r: {
    display_name?: string | null;
    product_name?: string | null;
    sigla_comercial?: string | null;
    fator_conversao?: number | string | null;
}): boolean {
    const name = norm(String(r.display_name || r.product_name || ""));
    const sigla = String(r.sigla_comercial ?? "").toUpperCase();
    if (sigla.includes("CX") || sigla.includes("FARD") || sigla.includes("PAC")) return true;
    if (/\bcx\b|caixa|c\/\d+/u.test(name)) return true;
    const fator = Number(r.fator_conversao ?? 1) || 1;
    return fator >= 6;
}

/** Tokens de marca/produto (não descritor/embalagem). */
function brandTokens(segment: string): string[] {
    const stop = new Set([
        "caixa",
        "caixas",
        "cx",
        "fardo",
        "pack",
        "pacote",
        "unidade",
        "unidades",
        "un",
        "lata",
        "long",
        "neck",
        "longneck",
        "garrafa",
        "pet",
        "litros",
        "litro",
        "quero",
        "uma",
        "duas",
        "dois",
        "tres",
        "três",
        "umas",
        "uns",
    ]);
    return norm(segment)
        .split(" ")
        .filter((t) => t.length >= 3 && !stop.has(t) && !/^\d/.test(t));
}

type HitRow = {
    id: string;
    display_name?: string | null;
    product_name?: string | null;
    sigla_comercial?: string | null;
    preco_venda?: number | string | null;
    fator_conversao?: number | string | null;
    produto_id?: string | null;
};

function minCaseFator(items: HitRow[]): number | null {
    let min: number | null = null;
    for (const r of items) {
        if (!isCasePack(r)) continue;
        const f = Number(r.fator_conversao ?? 0) || 0;
        if (f >= 2 && (min == null || f < min)) min = f;
    }
    return min;
}

/**
 * Intenção de embalagem: texto explícito (unidade/caixa) manda;
 * hábito e qty só entram quando a embalagem NÃO foi dita.
 */
export function resolvePackagingIntent(
    segment: string,
    items: HitRow[],
    opts?: ResolveSegmentPickOpts
): {
    wantCase: boolean;
    wantUnit: boolean;
    /** Reservado: hoje só ambíguo sem hábito claro; explícito nunca conflita. */
    habitConflict: boolean;
} {
    const explicitCase = prefersCase(segment);
    const explicitUnit = prefersUnit(segment);
    const habit = opts?.habit ?? null;
    const qty = Number(opts?.quantity);
    const qtyOk = Number.isFinite(qty) && qty > 0 ? qty : null;

    // Pedido claro ("2 unidades" / "1 caixa") → segue o texto; hábito não interfere.
    if (explicitCase || explicitUnit) {
        return {
            wantCase: explicitCase,
            wantUnit: explicitUnit,
            habitConflict: false,
        };
    }

    let wantCase = false;
    let wantUnit = false;
    if (habit === "UN") wantUnit = true;
    else if (habit === "CX") wantCase = true;
    else if (qtyOk != null) {
        const minF = minCaseFator(items);
        if (minF != null && qtyOk < minF) wantUnit = true;
    }

    return { wantCase, wantUnit, habitConflict: false };
}

function scoreItem(
    segment: string,
    r: HitRow,
    wantCase: boolean,
    wantUnit: boolean
): number {
    const seg = norm(segment);
    const name = norm(String(r.display_name || r.product_name || ""));
    let score = 0;

    const isCx = isCasePack(r);
    if (wantCase && isCx) score += 8;
    if (wantCase && !isCx) score -= 6;
    if (wantUnit && !isCx) score += 8;
    if (wantUnit && isCx) score -= 10;
    if (!wantCase && !wantUnit && !isCx) score += 3;

    if (/\blong\s*neck|longneck\b/u.test(seg)) {
        if (/\blong\s*neck|longneck\b/u.test(name)) score += 12;
        if (/\b600\b/u.test(name)) score -= 8;
        if (/\blata\b/u.test(name)) score -= 8;
    }

    const brands = brandTokens(seg);
    if (brands.length) {
        const hit = brands.filter((t) => name.includes(t));
        if (hit.length) score += 14 + hit.length * 4;
        else score -= 16;
    }

    for (const tok of seg.split(" ").filter((t) => t.length >= 4)) {
        if (name.includes(tok)) score += 2;
    }

    if (seg.includes("rosseiro") && name.includes("rosseiro")) score += 14;
    if (seg.includes("salgadinho") && name.includes("salgadinho")) score += 8;

    if (wantCase && /\blong\s*neck|longneck\b/u.test(seg) && /c\/\s*6\b|cx\s*c\/\s*6/u.test(name)) {
        score += 4;
    }

    return score;
}

function picksUnAndCx(ranked: Array<{ r: HitRow; score: number }>): SegmentPickRow[] {
    const un = ranked.find((x) => !isCasePack(x.r));
    const cx = ranked.find((x) => isCasePack(x.r));
    const out: SegmentPickRow[] = [];
    if (un) out.push(rowToPick(un.r));
    if (cx) out.push(rowToPick(cx.r));
    return out;
}

export function resolveSegmentPick(
    segment: string,
    items: HitRow[],
    opts?: ResolveSegmentPickOpts
):
    | { kind: "unique"; pick: SegmentPickRow }
    | { kind: "ambiguous"; picks: SegmentPickRow[]; habitConflict?: boolean }
    | { kind: "empty" } {
    if (!items.length) return { kind: "empty" };
    if (items.length === 1) return { kind: "unique", pick: rowToPick(items[0]!) };

    const intent = resolvePackagingIntent(segment, items, opts);

    let ranked = items
        .map((r) => ({
            r,
            score: scoreItem(segment, r, intent.wantCase, intent.wantUnit),
        }))
        .sort((a, b) => b.score - a.score);

    const brands = brandTokens(segment);
    if (brands.length) {
        const withBrand = ranked.filter((x) => {
            const name = norm(String(x.r.display_name || x.r.product_name || ""));
            return brands.some((t) => name.includes(t));
        });
        if (withBrand.length >= 1) ranked = withBrand;
    }

    if (intent.habitConflict) {
        const both = picksUnAndCx(ranked);
        if (both.length >= 2) {
            return { kind: "ambiguous", picks: both, habitConflict: true };
        }
    }

    const best = ranked[0]!;
    const second = ranked[1];
    if (!second || best.score >= second.score + 4) {
        return { kind: "unique", pick: rowToPick(best.r) };
    }

    if (intent.wantCase) {
        const cxOnly = ranked.filter((x) => isCasePack(x.r));
        if (cxOnly.length === 1) return { kind: "unique", pick: rowToPick(cxOnly[0]!.r) };
        if (cxOnly.length >= 2) {
            const a = cxOnly[0]!;
            const b = cxOnly[1]!;
            if (a.score >= b.score + 3) return { kind: "unique", pick: rowToPick(a.r) };
            return { kind: "ambiguous", picks: cxOnly.slice(0, 3).map((x) => rowToPick(x.r)) };
        }
    } else if (intent.wantUnit) {
        const unOnly = ranked.filter((x) => !isCasePack(x.r));
        if (unOnly.length === 1) return { kind: "unique", pick: rowToPick(unOnly[0]!.r) };
        if (unOnly.length >= 2) {
            const a = unOnly[0]!;
            const b = unOnly[1]!;
            if (a.score >= b.score + 3) return { kind: "unique", pick: rowToPick(a.r) };
            return { kind: "ambiguous", picks: unOnly.slice(0, 3).map((x) => rowToPick(x.r)) };
        }
    }

    return {
        kind: "ambiguous",
        picks: ranked.slice(0, 3).map((x) => rowToPick(x.r)),
    };
}
