/**
 * Resolve um segmento de pedido ("heineken long neck caixa") contra hits de busca.
 */

export type SegmentPickRow = {
    embalagemId: string;
    label: string;
    price?: number | null;
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
    preco_venda?: number | null;
}): SegmentPickRow {
    return {
        embalagemId: String(r.id),
        label: String(r.display_name || r.product_name || "Item").slice(0, 40),
        price: Number.isFinite(Number(r.preco_venda)) ? Number(r.preco_venda) : null,
    };
}

export function prefersCase(segment: string): boolean {
    return /\b(caixa|cx|fardo|pack)\b/u.test(norm(segment));
}

function scoreItem(
    segment: string,
    r: {
        id: string;
        display_name?: string | null;
        product_name?: string | null;
        sigla_comercial?: string | null;
        preco_venda?: number | null;
    }
): number {
    const seg = norm(segment);
    const name = norm(String(r.display_name || r.product_name || ""));
    const sigla = String(r.sigla_comercial ?? "").toUpperCase();
    let score = 0;

    const wantCase = prefersCase(seg);
    const isCx = sigla.includes("CX") || /\bcx\b|caixa|c\/\d+/u.test(name);
    if (wantCase && isCx) score += 8;
    if (wantCase && !isCx) score -= 6;
    if (!wantCase && !isCx) score += 3;

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
        preco_venda?: number | null;
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

    // Empate no topo: se pediu caixa, restringe a CX e tenta de novo
    if (prefersCase(segment)) {
        const cxOnly = ranked.filter((x) => {
            const sigla = String(x.r.sigla_comercial ?? "").toUpperCase();
            const name = norm(String(x.r.display_name || x.r.product_name || ""));
            return sigla.includes("CX") || /\bcx\b|caixa|c\/\d+/u.test(name);
        });
        if (cxOnly.length === 1) return { kind: "unique", pick: rowToPick(cxOnly[0]!.r) };
        if (cxOnly.length >= 2) {
            const a = cxOnly[0]!;
            const b = cxOnly[1]!;
            if (a.score >= b.score + 3) return { kind: "unique", pick: rowToPick(a.r) };
            return { kind: "ambiguous", picks: cxOnly.slice(0, 3).map((x) => rowToPick(x.r)) };
        }
    }

    return {
        kind: "ambiguous",
        picks: ranked.slice(0, 3).map((x) => rowToPick(x.r)),
    };
}
