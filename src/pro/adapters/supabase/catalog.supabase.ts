import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogPort, CatalogSearchOpts } from "@/src/pro/ports/catalog.port";
import {
    runSearchProdutosDetailed,
    type SearchProdutosResult,
} from "@/src/pro/tools/searchProdutos";

export class SupabaseCatalogAdapter implements CatalogPort {
    constructor(private readonly admin: SupabaseClient) {}

    searchDetailed(
        companyId: string,
        query: string,
        opts?: CatalogSearchOpts
    ): Promise<SearchProdutosResult> {
        return runSearchProdutosDetailed(this.admin, companyId, query, opts);
    }
}
