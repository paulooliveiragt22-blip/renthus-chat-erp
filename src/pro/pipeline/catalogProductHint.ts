/**
 * Hint falado ao cliente a partir de rótulos do catálogo (não do texto cru do cliente).
 */

export type CatalogPickForHint = {
    label?: string | null;
    productName?: string | null;
};

function commonPrefixWords(a: string, b: string): string {
    const wa = a.split(/\s+/).filter(Boolean);
    const wb = b.split(/\s+/).filter(Boolean);
    const out: string[] = [];
    for (let i = 0; i < Math.min(wa.length, wb.length); i++) {
        if (wa[i]!.toLowerCase() !== wb[i]!.toLowerCase()) break;
        out.push(wa[i]!);
    }
    return out.join(" ");
}

/**
 * Preferência: nome de produto compartilhado entre picks; senão stem comum dos labels;
 * senão primeiro label curto. Nunca devolve o segmento digitado pelo cliente.
 */
export function catalogProductHintFromPicks(
    picks: CatalogPickForHint[],
    opts?: { maxLen?: number }
): string | null {
    const maxLen = opts?.maxLen ?? 40;
    const names = picks
        .map((p) => String(p.productName ?? "").replaceAll(/\s+/g, " ").trim())
        .filter((n) => n.length >= 2);
    if (names.length >= 2) {
        const allSame = names.every((n) => n.toLowerCase() === names[0]!.toLowerCase());
        if (allSame) return names[0]!.slice(0, maxLen);
    }
    if (names.length === 1) return names[0]!.slice(0, maxLen);

    const labels = picks
        .map((p) => String(p.label ?? "").replaceAll(/\s+/g, " ").trim())
        .filter((n) => n.length >= 2);
    if (labels.length >= 2) {
        let stem = labels[0]!;
        for (let i = 1; i < labels.length; i++) {
            stem = commonPrefixWords(stem, labels[i]!);
            if (!stem) break;
        }
        if (stem.length >= 3) return stem.slice(0, maxLen);
    }
    if (labels[0]) return labels[0].slice(0, maxLen);
    return null;
}
