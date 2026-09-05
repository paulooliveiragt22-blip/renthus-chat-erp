import { NextRequest, NextResponse } from "next/server";
import { requireCompanyAnyPlanFeature, PDV_ACCESS_FEATURES } from "@/lib/billing/requirePlanFeature";
import { CATALOG_SNAPSHOT_MAX_ENTRIES } from "@/lib/offline/adapters/idbCatalogSnapshotStore";
import { mapPdvApiRowToSnapshotEntry } from "@/lib/offline/application/mapPdvRowToSnapshot";

export const runtime = "nodejs";

const SNAPSHOT_SELECT =
    "id, produto_id, descricao, fator_conversao, preco_venda, codigo_interno, codigo_barras_ean, tags, volume_quantidade, sigla_comercial, sigla_humanizada, volume_formatado, sales_count, product_name, category_name";

/**
 * GET /api/admin/pdv/catalog-snapshot
 * Dump paginado/enxuto para hydrate do IndexedDB (Perf-1). Sem estoque ao vivo.
 */
export async function GET(req: NextRequest) {
    const ctx = await requireCompanyAnyPlanFeature(
        [...PDV_ACCESS_FEATURES],
        ["owner", "admin", "member"],
        "pdv.access"
    );
    if (!ctx.ok) return ctx.response;
    const { admin, companyId } = ctx;

    const offsetRaw = Number.parseInt(req.nextUrl.searchParams.get("offset") ?? "0", 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    const limitRaw = Number.parseInt(
        req.nextUrl.searchParams.get("limit") ?? String(Math.min(500, CATALOG_SNAPSHOT_MAX_ENTRIES)),
        10
    );
    const limit = Math.min(
        CATALOG_SNAPSHOT_MAX_ENTRIES,
        Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 500)
    );

    const { data, error } = await admin
        .from("view_pdv_produtos")
        .select(SNAPSHOT_SELECT)
        .eq("company_id", companyId)
        .order("sales_count", { ascending: false })
        .range(offset, offset + limit - 1);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const rows = (data ?? []) as Record<string, unknown>[];
    const entries = rows.map(mapPdvApiRowToSnapshotEntry);

    return NextResponse.json({
        companyId,
        version: new Date().toISOString(),
        savedAt: new Date().toISOString(),
        offset,
        limit,
        truncated: entries.length >= limit || offset + entries.length >= CATALOG_SNAPSHOT_MAX_ENTRIES,
        maxEntries: CATALOG_SNAPSHOT_MAX_ENTRIES,
        entries,
        entryCount: entries.length,
    });
}
