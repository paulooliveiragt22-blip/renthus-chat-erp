/**
 * Índice local de busca/bipagem sobre snapshot (Perf-2).
 */

import type { CatalogSnapshotEntry } from "../ports/CatalogSnapshotStore";

export type CatalogSearchIndex = {
    byEan: Map<string, CatalogSnapshotEntry>;
    byCodigo: Map<string, CatalogSnapshotEntry>;
    /** tokens de nome → ids de embalagem */
    byNameToken: Map<string, Set<string>>;
    byId: Map<string, CatalogSnapshotEntry>;
};

function norm(s: string): string {
    return s
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .trim();
}

function digits(s: string): string {
    return s.replace(/\D/g, "");
}

export function buildCatalogSearchIndex(entries: CatalogSnapshotEntry[]): CatalogSearchIndex {
    const byEan = new Map<string, CatalogSnapshotEntry>();
    const byCodigo = new Map<string, CatalogSnapshotEntry>();
    const byNameToken = new Map<string, Set<string>>();
    const byId = new Map<string, CatalogSnapshotEntry>();

    for (const e of entries) {
        byId.set(e.embalagemId, e);

        if (e.ean) {
            byEan.set(e.ean.trim(), e);
            const d = digits(e.ean);
            if (d) byEan.set(d, e);
        }

        for (const code of [e.codigoInterno, e.codigoInternoEmbalagem]) {
            if (!code) continue;
            const t = code.trim();
            if (!t) continue;
            byCodigo.set(t, e);
            byCodigo.set(t.toLowerCase(), e);
        }

        const nameNorm = norm(e.name);
        for (const token of nameNorm.split(/\s+/).filter((t) => t.length >= 2)) {
            let set = byNameToken.get(token);
            if (!set) {
                set = new Set();
                byNameToken.set(token, set);
            }
            set.add(e.embalagemId);
        }
    }

    return { byEan, byCodigo, byNameToken, byId };
}

export function lookupCatalogExact(
    index: CatalogSearchIndex,
    raw: string
): CatalogSnapshotEntry | null {
    const q = raw.trim();
    if (!q) return null;
    return (
        index.byEan.get(q) ??
        index.byEan.get(digits(q)) ??
        index.byCodigo.get(q) ??
        index.byCodigo.get(q.toLowerCase()) ??
        null
    );
}

/** Busca por nome: interseção de tokens (máx. results). */
export function searchCatalogByName(
    index: CatalogSearchIndex,
    raw: string,
    limit = 40
): CatalogSnapshotEntry[] {
    const tokens = norm(raw)
        .split(/\s+/)
        .filter((t) => t.length >= 2);
    if (tokens.length === 0) return [];

    let ids: Set<string> | null = null;
    for (const token of tokens) {
        const hits = new Set<string>();
        for (const [k, set] of index.byNameToken) {
            if (k.startsWith(token) || k.includes(token)) {
                for (const id of set) hits.add(id);
            }
        }
        if (ids == null) ids = hits;
        else {
            const next = new Set<string>();
            for (const id of ids) if (hits.has(id)) next.add(id);
            ids = next;
        }
        if (ids.size === 0) return [];
    }

    const out: CatalogSnapshotEntry[] = [];
    for (const id of ids ?? []) {
        const e = index.byId.get(id);
        if (e) out.push(e);
        if (out.length >= limit) break;
    }
    out.sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0));
    return out;
}
