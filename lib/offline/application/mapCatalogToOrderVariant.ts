/**
 * Agrupa entradas do snapshot de catálogo no formato Variant de Pedidos (M2).
 */

import type { CatalogSnapshotEntry } from "../ports/CatalogSnapshotStore";
import type { Variant } from "@/lib/orders/types";
import {
    buildCatalogSearchIndex,
    lookupCatalogExact,
    searchCatalogByName,
} from "./buildCatalogSearchIndex";

function isCx(sigla: string | null): boolean {
    const s = String(sigla ?? "").toUpperCase();
    return s === "CX" || s === "FARD" || s === "PAC";
}

/** Agrupa por productId (UN + CX) como a API de search. */
export function mapCatalogEntriesToOrderVariants(entries: CatalogSnapshotEntry[]): Variant[] {
    const byProduct = new Map<
        string,
        { unit?: CatalogSnapshotEntry; case?: CatalogSnapshotEntry; any: CatalogSnapshotEntry }
    >();

    for (const e of entries) {
        const cur = byProduct.get(e.productId) ?? { any: e };
        if (isCx(e.sigla)) cur.case = e;
        else cur.unit = e;
        cur.any = e;
        byProduct.set(e.productId, cur);
    }

    const out: Variant[] = [];
    for (const [pid, g] of byProduct) {
        const unitPack = g.unit ?? g.case ?? g.any;
        const casePack = g.case;
        out.push({
            id: `${pid}__offline`,
            unit_price: Number(unitPack.precoVenda) || 0,
            has_case: Boolean(casePack),
            case_qty: casePack ? Number(casePack.fatorConversao) || 1 : null,
            case_price: casePack ? Number(casePack.precoVenda) || 0 : null,
            unit: null,
            volume_value: null,
            details: [unitPack.details, unitPack.volumeFormatado].filter(Boolean).join(" ") || null,
            tags: null,
            is_active: true,
            codigo_interno: unitPack.codigoInterno ?? unitPack.codigoInternoEmbalagem,
            codigo_barras_ean: unitPack.ean,
            unit_embalagem_id: g.unit?.embalagemId ?? unitPack.embalagemId,
            case_embalagem_id: casePack?.embalagemId ?? null,
            products: {
                name: unitPack.name,
                categories: unitPack.categoryName ? { name: unitPack.categoryName } : null,
            },
        });
    }
    return out;
}

export function searchOrderVariantsFromCatalogEntries(
    entries: CatalogSnapshotEntry[],
    q: string,
    limit = 40
): Variant[] {
    const t = q.trim();
    if (t.length < 2) return [];
    const index = buildCatalogSearchIndex(entries);
    const exact = lookupCatalogExact(index, t);
    const hitEntries = exact ? [exact] : searchCatalogByName(index, t, limit * 2);
    return mapCatalogEntriesToOrderVariants(hitEntries).slice(0, limit);
}
