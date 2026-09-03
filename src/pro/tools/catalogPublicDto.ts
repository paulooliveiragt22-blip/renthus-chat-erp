/**
 * DTO público do catálogo para tools do chatbot / LLM.
 * Nunca inclui custo, estoque numérico, códigos internos, UUIDs de produto-pai, etc.
 * Mantém `id` da embalagem (necessário para prepare_order_draft) — o sanitizer de texto
 * ao cliente remove UUIDs da prosa.
 */

export type ChatCatalogPublicItem = {
    id: string;
    produto_embalagem_id: string;
    product_name: string | null;
    display_name: string | null;
    /** Nome curto do item (ex.: LATA). */
    nome_item: string | null;
    /** Ingredientes / o que acompanha — DB `detalhes`. */
    descricao_ingredientes: string | null;
    /** Como é feito / info extra — DB `informacoes`. */
    informacoes: string | null;
    sigla_comercial: string | null;
    preco_venda: number | null;
    volume_quantidade: number | string | null;
    unit_type_sigla: string | null;
    /** Ex.: "350 ml" — composto no servidor para UI/clarify (C2). */
    volume_label: string | null;
    fator_conversao: number | null;
    tags: string | null;
    /** Só booleano de disponibilidade — nunca quantidade em estoque. */
    disponivel: boolean;
};

const SENSITIVE_KEYS = new Set([
    "preco_custo",
    "cost",
    "cost_price",
    "estoque",
    "estoque_atual",
    "estoque_unidades",
    "estoque_minimo",
    "disponivel_venda",
    "vender_com_estoque_zero",
    "produto_id",
    "product_id",
    "product_volume_id",
    "category_id",
    "company_id",
    "codigo_interno",
    "codigo_barras_ean",
    "ean",
    "sku",
    "thumbnail_url",
    "image_url",
    "score",
    "tags_auto",
    "is_acompanhamento",
    "item_is_active",
    "is_active",
]);

/** Compõe rótulo de volume para busca/clarify (ex.: "350 ml"). */
export function formatCatalogVolumeLabel(
    volumeQuantidade: number | string | null | undefined,
    unitTypeSigla: string | null | undefined
): string | null {
    if (volumeQuantidade == null || volumeQuantidade === "") return null;
    const qty =
        typeof volumeQuantidade === "number"
            ? Number.isFinite(volumeQuantidade)
                ? String(volumeQuantidade)
                : ""
            : String(volumeQuantidade).trim();
    if (!qty) return null;
    const unit = String(unitTypeSigla ?? "").trim();
    return unit ? `${qty} ${unit}` : qty;
}

export function toChatCatalogPublicItem(row: Record<string, unknown>): ChatCatalogPublicItem {
    const id = String(row.id ?? "").trim();
    const estoque = Number(row.estoque_unidades);
    const venderZero = row.vender_com_estoque_zero !== false;
    const disponivel =
        row.disponivel_venda != null
            ? Number(row.disponivel_venda) > 0
            : venderZero || (Number.isFinite(estoque) && estoque > 0);

    const preco = Number(row.preco_venda);
    const fator = Number(row.fator_conversao);
    const volume_quantidade =
        row.volume_quantidade == null || row.volume_quantidade === ""
            ? null
            : (row.volume_quantidade as number | string);
    const unit_type_sigla = String(row.unit_type_sigla ?? "").trim() || null;

    return {
        id,
        produto_embalagem_id: id,
        product_name: String(row.product_name ?? "").trim() || null,
        display_name: String(row.display_name ?? row.product_name ?? "").trim() || null,
        nome_item: String(row.descricao ?? "").trim() || null,
        descricao_ingredientes: String(row.detalhes ?? "").trim() || null,
        informacoes: String(row.informacoes ?? "").trim() || null,
        sigla_comercial: String(row.sigla_comercial ?? "").trim() || null,
        preco_venda: Number.isFinite(preco) ? preco : null,
        volume_quantidade,
        unit_type_sigla,
        volume_label: formatCatalogVolumeLabel(volume_quantidade, unit_type_sigla),
        fator_conversao: Number.isFinite(fator) && fator > 0 ? fator : null,
        tags: String(row.tags ?? "").trim() || null,
        disponivel,
    };
}

/** Remove chaves sensíveis se algum row cru vazar. */
export function stripSensitiveCatalogKeys<T extends Record<string, unknown>>(row: T): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
        if (SENSITIVE_KEYS.has(k)) continue;
        out[k] = v;
    }
    return out as Partial<T>;
}
