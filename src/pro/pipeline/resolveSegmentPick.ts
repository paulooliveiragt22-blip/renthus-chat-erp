/**
 * Resolve um segmento de pedido ("heineken long neck caixa") contra hits de busca.
 */

export type SegmentPickRow = {
    embalagemId: string;
    label: string;
    price?: number | null;
    /** Nome canónico do produto no catálogo (hint ao cliente). */
    productName?: string | null;
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
    // "long neck" sem caixa = unidade (CX seria "long neck caixa")
    if (/\blong\s*neck|longneck\b/u.test(s)) return true;
    return false;
}

function isCasePack(r: {
    display_name?: string | null;
    product_name?: string | null;
    sigla_comercial?: string | null;
}): boolean {
    const name = norm(String(r.display_name || r.product_name || ""));
    const sigla = String(r.sigla_comercial ?? "").toUpperCase();
    return sigla.includes("CX") || /\bcx\b|caixa|c\/\d+/u.test(name);
}

function scoreItem(
    segment: string,
    r: {
        id: string;
        display_name?: string | null;
        product_name?: string | null;
        sigla_comercial?: string | null;
        preco_venda?: number | string | null;
    }
): number {
    const seg = norm(segment);
    const name = norm(String(r.display_name || r.product_name || ""));
    let score = 0;

    const wantCase = prefersCase(seg);
    const wantUnit = prefersUnit(seg);
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

    // Tokens do segmento presentes no nome
    for (const tok of seg.split(" ").filter((t) => t.length >= 4)) {
        if (name.includes(tok)) score += 2;
    }

    if (seg.includes("rosseiro") && name.includes("rosseiro")) score += 14;
    if (seg.includes("salgadinho") && name.includes("salgadinho")) score += 8;

    // Prefer CX c/6 para long neck caixa quando empate
    if (wantCase && /\blong\s*neck|longneck\b/u.test(seg) && /c\/\s*6\b|cx\s*c\/\s*6/u.test(name)) {
        score += 4;
    }

    return score;
}

export function resolveSegmentPick(
    segment: string,
    items: Array<{
        id: string;
        display_name?: string | null;
        product_name?: string | null;
        preco_venda?: number | string | null;
        sigla_comercial?: string | null;
    }>
): { kind: "unique"; pick: SegmentPickRow } | { kind: "ambiguous"; picks: SegmentPickRow[] } | { kind: "empty" } {
    if (!items.length) return { kind: "empty" };
    if (items.length === 1) return { kind: "unique", pick: rowToPick(items[0]!) };

    const ranked = items
        .map((r) => ({ r, score: scoreItem(segment, r) }))
        .sort((a, b) => b.score - a.score);

    const best = ranked[0]!;
    const second = ranked[1];
    // Vitória clara do top-1
    if (!second || best.score >= second.score + 4) {
        return { kind: "unique", pick: rowToPick(best.r) };
    }

    // Empate no topo: se pediu caixa, restringe a CX; se pediu unidade/long neck, restringe a UN
    if (prefersCase(segment)) {
        const cxOnly = ranked.filter((x) => isCasePack(x.r));
        if (cxOnly.length === 1) return { kind: "unique", pick: rowToPick(cxOnly[0]!.r) };
        if (cxOnly.length >= 2) {
            const a = cxOnly[0]!;
            const b = cxOnly[1]!;
            if (a.score >= b.score + 3) return { kind: "unique", pick: rowToPick(a.r) };
            return { kind: "ambiguous", picks: cxOnly.slice(0, 3).map((x) => rowToPick(x.r)) };
        }
    } else if (prefersUnit(segment)) {
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
