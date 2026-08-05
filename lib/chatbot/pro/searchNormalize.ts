/**
 * Normalização PT-BR para busca de catálogo (typos leves, plural, acentos).
 */

export function normalizeSearchKey(raw: string): string {
    return String(raw ?? "")
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{Diacritic}/gu, "")
        .replaceAll(/[^a-z0-9\s]/g, " ")
        .replaceAll(/\s+/g, " ")
        .trim();
}

/** Gera variantes (plural → singular) para ILIKE / RPC. */
export function expandSearchVariants(query: string): string[] {
    const base = normalizeSearchKey(query);
    if (!base) return [];
    const out = new Set<string>([base]);
    const tokens = base.split(" ").filter(Boolean);
    const stemToken = (t: string): string[] => {
        const v = new Set<string>([t]);
        if (t.length > 5 && t.endsWith("es")) v.add(t.slice(0, -2));
        if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) v.add(t.slice(0, -1));
        // hamburgueres → hamburguer (já coberto); cervejas → cerveja
        if (t.length > 6 && t.endsWith("oes")) v.add(`${t.slice(0, -3)}ao`);
        return [...v];
    };
    for (const t of tokens) {
        for (const s of stemToken(t)) out.add(s);
    }
    // Frase com último token stemado
    if (tokens.length > 1) {
        const lastStems = stemToken(tokens[tokens.length - 1]!);
        for (const ls of lastStems) {
            out.add([...tokens.slice(0, -1), ls].join(" "));
        }
    }
    return [...out].filter((v) => v.length >= 2).slice(0, 8);
}

export function scoreDidYouMean(query: string, candidate: string): number {
    const q = normalizeSearchKey(query);
    const c = normalizeSearchKey(candidate);
    if (!q || !c) return 0;
    if (c.includes(q) || q.includes(c)) return 0.9;
    const qt = new Set(q.split(" "));
    const ct = c.split(" ");
    let hit = 0;
    for (const t of ct) {
        for (const qq of qt) {
            if (t.startsWith(qq) || qq.startsWith(t) || (qq.length > 3 && t.includes(qq))) {
                hit += 1;
                break;
            }
        }
    }
    return hit / Math.max(ct.length, 1);
}
