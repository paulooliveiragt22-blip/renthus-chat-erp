import type { SupabaseClient } from "@supabase/supabase-js";
import {
    pickMinimumGapSuggestions,
    type GapCatalogRow,
    type GapDraftLine,
    type GapFillSuggestion,
} from "./minimumGapFill";

type CatalogViewRow = {
    id?: string;
    product_name?: string | null;
    display_name?: string | null;
    preco_venda?: number | string | null;
    sigla_comercial?: string | null;
};

function toCatalogRow(row: CatalogViewRow): GapCatalogRow | null {
    const id = String(row.id ?? "").trim();
    const price = Number(row.preco_venda);
    const label = String(row.display_name || row.product_name || "").trim();
    if (!id || !label || !Number.isFinite(price) || price <= 0) return null;
    return {
        id,
        productName: String(row.product_name ?? ""),
        label,
        price,
        sigla: String(row.sigla_comercial ?? "").trim().toUpperCase(),
    };
}

/**
 * Sugestão para fechar o mínimo: mesma marca+embalagem, senão acompanhamento do cadastro.
 */
export async function loadMinimumGapSuggestions(params: {
    admin: SupabaseClient;
    companyId: string;
    items: readonly GapDraftLine[];
}): Promise<GapFillSuggestion[]> {
    const draftIds = params.items.map((i) => i.produtoEmbalagemId).filter(Boolean);
    if (!draftIds.length) return [];
    const siglas = [
        ...new Set(
            params.items
                .map((i) => String(i.sigla ?? "").trim().toUpperCase())
                .filter(Boolean)
        ),
    ];

    let catalog: GapCatalogRow[] = [];
    if (siglas.length) {
        const { data, error } = await params.admin
            .from("view_chat_produtos")
            .select("id, product_name, display_name, preco_venda, sigla_comercial")
            .eq("company_id", params.companyId)
            .in("sigla_comercial", siglas)
            .limit(80);
        if (!error && Array.isArray(data)) {
            catalog = data
                .map((row) => toCatalogRow(row as CatalogViewRow))
                .filter((row): row is GapCatalogRow => row != null);
        }
    }

    const { data: links, error: linkError } = await params.admin
        .from("view_produto_embalagem_acompanhamentos")
        .select("acompanhamento_produto_embalagem_id, ordem")
        .in("produto_embalagem_id", draftIds);
    const orderedIds: string[] = [];
    if (!linkError && Array.isArray(links)) {
        const sorted = [...links].sort(
            (a, b) => Number((a as { ordem?: number }).ordem ?? 0) - Number((b as { ordem?: number }).ordem ?? 0)
        );
        for (const link of sorted) {
            const id = String(
                (link as { acompanhamento_produto_embalagem_id?: string }).acompanhamento_produto_embalagem_id ?? ""
            ).trim();
            if (id && !orderedIds.includes(id)) orderedIds.push(id);
        }
    }

    let accompaniments: GapCatalogRow[] = [];
    if (orderedIds.length) {
        const { data, error } = await params.admin
            .from("view_chat_produtos")
            .select("id, product_name, display_name, preco_venda, sigla_comercial")
            .eq("company_id", params.companyId)
            .in("id", orderedIds.slice(0, 12));
        if (!error && Array.isArray(data)) {
            const byId = new Map<string, GapCatalogRow>();
            for (const row of data) {
                const parsed = toCatalogRow(row as CatalogViewRow);
                if (parsed) byId.set(parsed.id, parsed);
            }
            accompaniments = orderedIds
                .map((id) => byId.get(id))
                .filter((row): row is GapCatalogRow => row != null);
        }
    }

    return pickMinimumGapSuggestions({
        draft: params.items,
        catalog,
        accompaniments,
    });
}
