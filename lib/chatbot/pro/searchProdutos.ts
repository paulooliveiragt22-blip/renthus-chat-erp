import type { SupabaseClient } from "@supabase/supabase-js";
import {
    disponivelVenda,
    shouldHideWhenOutOfStock,
} from "@/lib/products/stockPolicy";
import { buildPackDisplayName } from "@/lib/products/packDisplayName";
import { expandSearchVariants, scoreDidYouMean } from "./searchNormalize";
import {
    catalogSearchCacheKey,
    getCachedCatalogSearch,
    setCachedCatalogSearch,
} from "./catalogSearchCache";
import { applySearchRelevanceRerank } from "./searchRelevance";

export type ChatProdutoRow = {
    id:                   string;
    product_name:         string;
    display_name?:        string | null;
    descricao:            string | null;
    detalhes?:            string | null;
    sigla_comercial:      string | null;
    preco_venda:          number | string | null;
    volume_quantidade:    number | string | null;
    unit_type_sigla:      string | null;
    fator_conversao:      number | string | null;
    product_volume_id:    string | null;
    category_id:          string | null;
    produto_id?:          string | null;
    estoque_unidades?:    number;
    vender_com_estoque_zero?: boolean;
    disponivel_venda?:    number;
    score?:               number;
};

export type SearchProdutosResult = {
    items: ChatProdutoRow[];
    didYouMean: Array<{ id: string; label: string; score: number }>;
    empty: boolean;
    queryNormalized: string;
};

function sanitizeSearchQuery(raw: string): string {
    return raw.replaceAll("%", "").replaceAll("'", "").trim().slice(0, 80);
}

const SELECT_FULL =
    "id, produto_id, product_name, display_name, descricao, detalhes, sigla_comercial, preco_venda, volume_quantidade, unit_type_sigla, fator_conversao, product_volume_id, category_id, estoque_unidades, vender_com_estoque_zero, thumbnail_url, image_url, tags, tags_auto";
const SELECT_LEGACY =
    "id, produto_id, product_name, descricao, sigla_comercial, preco_venda, volume_quantidade, unit_type_sigla, fator_conversao, product_volume_id, category_id";

async function attachEstoqueFallback(
    admin: SupabaseClient,
    rows: ChatProdutoRow[]
): Promise<void> {
    const needFallback = rows.filter((r) => !Number.isFinite(Number(r.estoque_unidades)));
    const volIds = [
        ...new Set(needFallback.map((r) => r.product_volume_id).filter(Boolean)),
    ] as string[];
    const productIds = [
        ...new Set(
            rows
                .filter((r) => !Number.isFinite(Number(r.estoque_unidades)) && r.produto_id)
                .map((r) => String(r.produto_id))
        ),
    ];

    const mapByVol = new Map<string, number>();
    const mapByProduct = new Map<string, number>();

    if (volIds.length) {
        const { data: vols } = await admin
            .from("product_volumes")
            .select("id, estoque_atual")
            .in("id", volIds);
        for (const v of vols ?? []) {
            mapByVol.set(v.id as string, Number(v.estoque_atual ?? 0));
        }
    }
    if (productIds.length) {
        const { data: vols } = await admin
            .from("product_volumes")
            .select("product_id, estoque_atual")
            .in("product_id", productIds)
            .order("volume_quantidade", { ascending: true, nullsFirst: true });
        for (const v of vols ?? []) {
            const pid = String(v.product_id);
            if (!mapByProduct.has(pid)) {
                mapByProduct.set(pid, Number(v.estoque_atual ?? 0));
            }
        }
    }

    for (const r of rows) {
        if (Number.isFinite(Number(r.estoque_unidades))) continue;
        if (r.product_volume_id && mapByVol.has(r.product_volume_id)) {
            r.estoque_unidades = mapByVol.get(r.product_volume_id);
        } else if (r.produto_id && mapByProduct.has(String(r.produto_id))) {
            r.estoque_unidades = mapByProduct.get(String(r.produto_id));
        } else {
            r.estoque_unidades = 0;
        }
    }
}

function enrichAndFilter(rows: ChatProdutoRow[]): ChatProdutoRow[] {
    const out: ChatProdutoRow[] = [];
    for (const r of rows) {
        const estoque = Number(r.estoque_unidades ?? 0);
        const fator = Number(r.fator_conversao ?? 1) || 1;
        const venderZero = r.vender_com_estoque_zero !== false;
        if (shouldHideWhenOutOfStock(venderZero, estoque)) continue;
        r.estoque_unidades = estoque;
        r.vender_com_estoque_zero = venderZero;
        r.disponivel_venda = disponivelVenda(estoque, fator);
        const display =
            (typeof r.display_name === "string" && r.display_name.trim()) ||
            buildPackDisplayName({
                productName: r.product_name,
                itemName: r.descricao,
                sigla: r.sigla_comercial,
                volumeQuantidade: r.volume_quantidade,
                unitSigla: r.unit_type_sigla,
                fatorConversao: r.fator_conversao,
            });
        r.display_name = display;
        r.product_name = display;
        out.push(r);
    }
    return out;
}

async function finalizeRows(
    admin: SupabaseClient,
    rows: ChatProdutoRow[]
): Promise<ChatProdutoRow[]> {
    await attachEstoqueFallback(admin, rows);
    return enrichAndFilter(rows);
}

function buildDidYouMean(query: string, rows: ChatProdutoRow[]) {
    return rows
        .map((r) => ({
            id: String(r.id),
            label: String(r.display_name || r.product_name || "").trim(),
            score: Number(r.score ?? scoreDidYouMean(query, String(r.product_name ?? ""))),
        }))
        .filter((x) => x.label && x.score > 0 && x.score < 0.92)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
}

async function searchViaRpc(
    admin: SupabaseClient,
    companyId: string,
    query: string,
    limit: number
): Promise<ChatProdutoRow[] | null> {
    const { data, error } = await admin.rpc("rpc_search_chat_produtos", {
        p_company_id: companyId,
        p_query: query,
        p_limit: limit,
    });
    if (error || !data || typeof data !== "object") return null;
    const items = (data as { items?: unknown }).items;
    if (!Array.isArray(items)) return null;
    return items as ChatProdutoRow[];
}

/** Fallback: OR ILIKE em name/descricao/tags/display com variantes de plural. */
async function searchViaIlikeFallback(
    admin: SupabaseClient,
    companyId: string,
    query: string,
    limit: number
): Promise<ChatProdutoRow[]> {
    const variants = expandSearchVariants(query);
    if (!variants.length) return [];

    const cols = ["product_name", "descricao", "display_name", "tags", "tags_auto", "detalhes"] as const;
    const orFilter = variants
        .flatMap((v) => {
            const safe = v.replaceAll(",", " ").replaceAll("%", "");
            return cols.map((col) => `${col}.ilike.%${safe}%`);
        })
        .join(",");

    const full = await admin
        .from("view_chat_produtos")
        .select(SELECT_FULL)
        .eq("company_id", companyId)
        .or(orFilter)
        .limit(limit * 3);

    let rows = (full.data ?? []) as ChatProdutoRow[];
    if (full.error) {
        const simpleOr = variants
            .flatMap((v) => {
                const safe = v.replaceAll(",", " ").replaceAll("%", "");
                return [`product_name.ilike.%${safe}%`, `descricao.ilike.%${safe}%`];
            })
            .join(",");
        const legacy = await admin
            .from("view_chat_produtos")
            .select(SELECT_LEGACY)
            .eq("company_id", companyId)
            .or(simpleOr)
            .limit(limit * 3);
        rows = (legacy.data ?? []) as ChatProdutoRow[];
    }

    // Score em memória
    for (const r of rows) {
        const label = `${r.product_name ?? ""} ${r.descricao ?? ""} ${r.display_name ?? ""}`;
        r.score = Math.max(
            ...variants.map((v) => scoreDidYouMean(v, label)),
            scoreDidYouMean(query, label)
        );
    }
    rows.sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
    return rows.slice(0, limit * 2);
}

export async function runSearchProdutosDetailed(
    admin: SupabaseClient,
    companyId: string,
    query: string,
    opts?: { categoryHint?: string | null; limit?: number }
): Promise<SearchProdutosResult> {
    const limit = Math.min(Math.max(opts?.limit ?? 8, 1), 20);
    const q = sanitizeSearchQuery(query);
    const queryNormalized = expandSearchVariants(q)[0] ?? q;
    const cacheKey = catalogSearchCacheKey({
        companyId,
        query: q,
        categoryHint: opts?.categoryHint,
        limit,
    });
    const cached = getCachedCatalogSearch(cacheKey);
    if (cached) {
        return {
            ...cached,
            items: cached.items.map((r) => ({ ...r })),
            didYouMean: cached.didYouMean.map((d) => ({ ...d })),
        };
    }

    if (opts?.categoryHint) {
        const hint = sanitizeSearchQuery(opts.categoryHint);
        if (hint) {
            const { data: cats } = await admin
                .from("categories")
                .select("id")
                .eq("company_id", companyId)
                .ilike("name", `%${hint}%`)
                .limit(3);
            const catIds = (cats ?? []).map((c) => c.id as string);
            if (catIds.length) {
                const full = await admin
                    .from("view_chat_produtos")
                    .select(SELECT_FULL)
                    .eq("company_id", companyId)
                    .in("category_id", catIds)
                    .order("product_name")
                    .limit(limit * 2);
                let catRows = (full.data ?? null) as ChatProdutoRow[] | null;
                if (full.error) {
                    const legacy = await admin
                        .from("view_chat_produtos")
                        .select(SELECT_LEGACY)
                        .eq("company_id", companyId)
                        .in("category_id", catIds)
                        .order("product_name")
                        .limit(limit * 2);
                    catRows = (legacy.data ?? []) as ChatProdutoRow[];
                }
                const rows = await finalizeRows(admin, catRows ?? []);
                const items = rows.slice(0, limit);
                const result: SearchProdutosResult = {
                    items,
                    didYouMean: [],
                    empty: items.length === 0,
                    queryNormalized: hint,
                };
                setCachedCatalogSearch(cacheKey, result);
                return result;
            }
        }
    }

    if (!q) {
        return { items: [], didYouMean: [], empty: true, queryNormalized: "" };
    }

    /** Pool maior para rerank (descritor/CX/volume) antes de cortar o top-N. */
    const poolLimit = Math.min(limit * 3, 20);
    let rows = (await searchViaRpc(admin, companyId, q, poolLimit)) ?? [];
    if (!rows.length) {
        rows = await searchViaIlikeFallback(admin, companyId, q, poolLimit);
    }

    const finalized = await finalizeRows(admin, rows);
    const ranked = applySearchRelevanceRerank(q, finalized);
    const items = ranked.slice(0, limit);
    const result: SearchProdutosResult = {
        items,
        didYouMean: buildDidYouMean(q, items),
        empty: items.length === 0,
        queryNormalized,
    };
    setCachedCatalogSearch(cacheKey, result);
    return result;
}

/** Compat: retorna só as linhas (handlers legados). */
export async function runSearchProdutos(
    admin: SupabaseClient,
    companyId: string,
    query: string,
    opts?: { categoryHint?: string | null; limit?: number }
): Promise<ChatProdutoRow[]> {
    const r = await runSearchProdutosDetailed(admin, companyId, query, opts);
    return r.items;
}
