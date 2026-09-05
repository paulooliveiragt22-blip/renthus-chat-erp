/**
 * Mapeia rows da API PDV → entradas de snapshot.
 */

import type { CatalogSnapshotEntry } from "../ports/CatalogSnapshotStore";

export function mapPdvApiRowToSnapshotEntry(r: Record<string, unknown>): CatalogSnapshotEntry {
    const codigo = r.codigo_interno != null ? String(r.codigo_interno) : null;
    return {
        productId: String(r.produto_id ?? ""),
        embalagemId: String(r.id ?? ""),
        name: String(r.product_name ?? "Produto"),
        precoVenda: Number(r.preco_venda ?? 0),
        sigla: r.sigla_comercial != null ? String(r.sigla_comercial) : null,
        fatorConversao: Math.max(1, Number(r.fator_conversao ?? 1)),
        ean: r.codigo_barras_ean != null ? String(r.codigo_barras_ean) : null,
        codigoInterno: codigo,
        codigoInternoEmbalagem: codigo,
        venderComEstoqueZero: r.vender_com_estoque_zero !== false,
        categoryName: r.category_name != null ? String(r.category_name) : null,
        details: r.descricao != null ? String(r.descricao) : null,
        siglaHumanizada: r.sigla_humanizada != null ? String(r.sigla_humanizada) : null,
        volumeFormatado: r.volume_formatado != null ? String(r.volume_formatado) : null,
        salesCount: Number(r.sales_count ?? 0),
    };
}
