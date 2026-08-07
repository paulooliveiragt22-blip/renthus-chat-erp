import type { SearchProdutosResult } from "@/src/pro/tools/searchProdutos";

export type CatalogSearchOpts = {
    categoryHint?: string | null;
    limit?: number;
};

/**
 * Porta de catálogo (leitura) — agent loop / tools não conhecem Supabase.
 */
export interface CatalogPort {
    searchDetailed(
        companyId: string,
        query: string,
        opts?: CatalogSearchOpts
    ): Promise<SearchProdutosResult>;
}
