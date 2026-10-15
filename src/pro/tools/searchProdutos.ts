import type { SupabaseClient } from "@supabase/supabase-js";
import {
    disponivelVenda,
    shouldHideWhenOutOfStock,
} from "@/lib/products/stockPolicy";
import { buildPackDisplayName } from "@/lib/products/packDisplayName";
import { expandSearchVariants, scoreDidYouMean } from "./searchNormalize";
import {
    catalogSearchCacheKey,
    getCachedCatalogSearchAsync,
    setCachedCatalogSearchAsync,
} from "./catalogSearchCache";
import { applySearchRelevanceRerank } from "./searchRelevance";
import { preferRowsMatchingTagAliases } from "./tagAliasMatch";
import {
    catalogOfferListKind,
    formatCatalogOfferList,
    type CatalogOfferListKind,
} from "./catalogOfferList";

export type ChatProdutoRow = {
    id:                   string;
    product_name:         string;
    display_name?:        string | null;
    descricao:            string | null;
    /** Ingredientes / o que acompanha. */
    detalhes?:            string | null;
    /** Como é feito / info extra (não confundir com ingredientes). */
    informacoes?:         string | null;
    tags?:                string | null;
    tags_auto?:           string | null;
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
    /** Vitrine pedida pelo cliente: promoções ativas ou combos do cardápio. */
    offerList?: CatalogOfferListKind | null;
};

function sanitizeSearchQuery(raw: string): string {
    return raw.replaceAll("%", "").replaceAll("'", "").trim().slice(0, 80);
}

const SELECT_FULL =
    "id, produto_id, product_name, display_name, descricao, detalhes, informacoes, sigla_comercial, preco_venda, volume_quantidade, unit_type_sigla, fator_conversao, product_volume_id, category_id, estoque_unidades, vender_com_estoque_zero, thumbnail_url, image_url, tags, tags_auto";

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

/**
 * Embalagens irmãs do mesmo volume (UN↔CX) — quando a tag está só numa sigla
 * e o cliente pediu a outra.
 */
export async function loadEmbalagensByVolumeIds(
    admin: SupabaseClient,
    companyId: string,
    volumeIds: readonly string[]
): Promise<ChatProdutoRow[]> {
    const ids = [...new Set(volumeIds.map((v) => String(v ?? "").trim()).filter(Boolean))];
    if (!ids.length) return [];
    const { data, error } = await admin
        .from("view_chat_produtos")
        .select(SELECT_FULL)
        .eq("company_id", companyId)
        .in("product_volume_id", ids)
        .limit(24);
    if (error || !data?.length) return [];
    return finalizeRows(admin, data as ChatProdutoRow[]);
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

type ComboItemJson = {
    quantidade?: number | string;
    nome?: string;
};

function comboComposition(itens: unknown): string | null {
    if (!Array.isArray(itens) || itens.length === 0) return null;
    const parts: string[] = [];
    for (const raw of itens) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as ComboItemJson;
        const qty = Number(item.quantidade);
        const q = Number.isFinite(qty) && qty > 0 ? qty : 1;
        const name = String(item.nome ?? "").trim() || "Item";
        parts.push(`${q}× ${name}`);
    }
    return parts.length ? parts.join(" · ") : null;
}

function comboToChatRow(input: {
    id: string;
    nome: string;
    preco: number;
    disponivel: number | null;
    descricao?: string | null;
    itens?: unknown;
}): ChatProdutoRow | null {
    const nome = input.nome.trim();
    if (!input.id || !nome || !Number.isFinite(input.preco) || input.preco <= 0) return null;
    const ilimitado = input.disponivel == null;
    return {
        id: input.id,
        product_name: nome,
        display_name: nome,
        descricao: null,
        detalhes: comboComposition(input.itens),
        informacoes: String(input.descricao ?? "").trim() || null,
        sigla_comercial: "KIT",
        preco_venda: input.preco,
        volume_quantidade: null,
        unit_type_sigla: null,
        fator_conversao: 1,
        product_volume_id: null,
        category_id: null,
        estoque_unidades: ilimitado ? 0 : Number(input.disponivel),
        vender_com_estoque_zero: ilimitado,
        disponivel_venda: ilimitado ? 99 : Number(input.disponivel),
    };
}

async function loadComboExtras(
    admin: SupabaseClient,
    companyId: string,
    ids: readonly string[]
): Promise<Map<string, { descricao: string | null; itens: unknown }>> {
    const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    const out = new Map<string, { descricao: string | null; itens: unknown }>();
    if (!unique.length) return out;
    const { data, error } = await admin
        .from("v_sec_combos")
        .select("id, descricao, itens")
        .eq("company_id", companyId)
        .in("id", unique);
    if (error || !data) return out;
    for (const row of data) {
        const id = String(row.id ?? "");
        if (!id) continue;
        out.set(id, {
            descricao: row.descricao == null ? null : String(row.descricao),
            itens: row.itens,
        });
    }
    return out;
}

async function searchChatCombos(
    admin: SupabaseClient,
    companyId: string,
    query: string
): Promise<ChatProdutoRow[]> {
    const { data, error } = await admin.rpc("rpc_search_chat_combos", {
        p_company_id: companyId,
        p_query: query,
    });
    if (error || !Array.isArray(data)) return [];
    const parsed: Array<{ id: string; nome: string; preco: number; disponivel: number | null }> = [];
    for (const raw of data) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as {
            id?: string;
            nome?: string;
            preco?: number | string;
            disponivel?: number | null;
        };
        const id = String(row.id ?? "");
        const nome = String(row.nome ?? "").trim();
        const preco = Number(row.preco);
        if (!id || !nome || !Number.isFinite(preco) || preco <= 0) continue;
        parsed.push({
            id,
            nome,
            preco,
            disponivel: row.disponivel == null ? null : Number(row.disponivel),
        });
    }
    const extras = await loadComboExtras(
        admin,
        companyId,
        parsed.map((row) => row.id)
    );
    const out: ChatProdutoRow[] = [];
    for (const row of parsed) {
        const extra = extras.get(row.id);
        const chat = comboToChatRow({
            ...row,
            descricao: extra?.descricao,
            itens: extra?.itens,
        });
        if (chat) out.push(chat);
    }
    return out;
}

/** Preço que o cliente paga. Não devolve o preço de catálogo. */
async function attachEffectivePackPrices(
    admin: SupabaseClient,
    companyId: string,
    rows: ChatProdutoRow[]
): Promise<ChatProdutoRow[]> {
    const ids = [
        ...new Set(
            rows
                .filter((row) => String(row.sigla_comercial ?? "").toUpperCase() !== "KIT")
                .map((row) => String(row.id ?? "").trim())
                .filter(Boolean)
        ),
    ];
    if (!ids.length) return rows;
    const { data, error } = await admin
        .from("v_sec_preco_efetivo_embalagem")
        .select("id, preco_efetivo")
        .eq("company_id", companyId)
        .in("id", ids);
    if (error || !data) return rows;
    const byId = new Map<string, number>();
    for (const row of data) {
        const price = Number(row.preco_efetivo);
        if (Number.isFinite(price) && price > 0) byId.set(String(row.id), price);
    }
    return rows.map((row) => {
        const price = byId.get(String(row.id));
        return price != null ? { ...row, preco_venda: price } : row;
    });
}

async function listActiveComboRows(
    admin: SupabaseClient,
    companyId: string
): Promise<ChatProdutoRow[]> {
    const { data, error } = await admin
        .from("v_sec_combos")
        .select("id, nome, descricao, preco_efetivo, disponivel, itens")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .eq("show_on_menu", true)
        .not("preco", "is", null)
        .order("nome")
        .limit(8);
    if (error || !data) return [];
    const out: ChatProdutoRow[] = [];
    for (const row of data) {
        const chat = comboToChatRow({
            id: String(row.id ?? ""),
            nome: String(row.nome ?? ""),
            preco: Number(row.preco_efetivo),
            disponivel: row.disponivel == null ? null : Number(row.disponivel),
            descricao: row.descricao == null ? null : String(row.descricao),
            itens: row.itens,
        });
        if (chat) out.push(chat);
    }
    return out;
}

async function listActivePromoRows(
    admin: SupabaseClient,
    companyId: string
): Promise<ChatProdutoRow[]> {
    const { data, error } = await admin
        .from("v_sec_promocoes")
        .select("alvos")
        .eq("company_id", companyId)
        .eq("status", "ativa")
        .limit(5);
    if (error || !data) return [];

    const embIds: string[] = [];
    const comboIds: string[] = [];
    const orderedIds: string[] = [];
    for (const promo of data) {
        const alvos = Array.isArray(promo.alvos) ? promo.alvos : [];
        for (const raw of alvos) {
            if (!raw || typeof raw !== "object") continue;
            const alvo = raw as { combo_id?: string | null; produto_embalagem_id?: string | null };
            const comboId = String(alvo.combo_id ?? "").trim();
            const embId = String(alvo.produto_embalagem_id ?? "").trim();
            if (comboId) {
                comboIds.push(comboId);
                orderedIds.push(comboId);
            } else if (embId) {
                embIds.push(embId);
                orderedIds.push(embId);
            }
        }
    }

    const packs = new Map<string, ChatProdutoRow>();
    if (embIds.length) {
        const { data: rows } = await admin
            .from("view_chat_produtos")
            .select(SELECT_FULL)
            .eq("company_id", companyId)
            .in("id", [...new Set(embIds)]);
        const finalized = await attachEffectivePackPrices(
            admin,
            companyId,
            await finalizeRows(admin, (rows ?? []) as ChatProdutoRow[])
        );
        for (const row of finalized) packs.set(String(row.id), row);
    }

    const combos = new Map<string, ChatProdutoRow>();
    if (comboIds.length) {
        const { data: rows } = await admin
            .from("v_sec_combos")
            .select("id, nome, descricao, preco_efetivo, disponivel, itens, is_active")
            .eq("company_id", companyId)
            .in("id", [...new Set(comboIds)]);
        for (const row of rows ?? []) {
            if (row.is_active !== true) continue;
            const chat = comboToChatRow({
                id: String(row.id ?? ""),
                nome: String(row.nome ?? ""),
                preco: Number(row.preco_efetivo),
                disponivel: row.disponivel == null ? null : Number(row.disponivel),
                descricao: row.descricao == null ? null : String(row.descricao),
                itens: row.itens,
            });
            if (chat) combos.set(chat.id, chat);
        }
    }

    const out: ChatProdutoRow[] = [];
    const seen = new Set<string>();
    for (const id of orderedIds) {
        if (seen.has(id)) continue;
        const row = packs.get(id) ?? combos.get(id);
        if (!row) continue;
        seen.add(id);
        out.push(row);
        if (out.length >= 8) break;
    }
    return out;
}

export async function loadCatalogOfferReply(
    admin: SupabaseClient,
    companyId: string,
    kind: CatalogOfferListKind
): Promise<string> {
    const items = kind === "promos"
        ? await listActivePromoRows(admin, companyId)
        : await listActiveComboRows(admin, companyId);
    return formatCatalogOfferList(
        kind,
        items.map((row) => ({
            name: String(row.display_name || row.product_name || "").trim(),
            price: Number(row.preco_venda),
            composition: String(row.sigla_comercial ?? "").toUpperCase() === "KIT" ? row.detalhes : null,
        }))
    );
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

    if (full.error) {
        console.warn("[searchProdutos] view_chat_produtos ilike error", full.error.message);
        return [];
    }

    const rows = (full.data ?? []) as ChatProdutoRow[];

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

async function withSpokenPrices(
    admin: SupabaseClient,
    companyId: string,
    result: SearchProdutosResult
): Promise<SearchProdutosResult> {
    if (result.offerList) return result;
    return {
        ...result,
        items: await attachEffectivePackPrices(admin, companyId, result.items),
    };
}

export async function runSearchProdutosDetailed(
    admin: SupabaseClient,
    companyId: string,
    query: string,
    opts?: { categoryHint?: string | null; limit?: number }
): Promise<SearchProdutosResult> {
    const limit = Math.min(Math.max(opts?.limit ?? 8, 1), 20);
    const q = sanitizeSearchQuery(query);
    const listKind = catalogOfferListKind(q);
    if (listKind) {
        const items = listKind === "promos"
            ? await listActivePromoRows(admin, companyId)
            : await listActiveComboRows(admin, companyId);
        return {
            items,
            didYouMean: [],
            empty: items.length === 0,
            queryNormalized: q,
            offerList: listKind,
        };
    }
    const queryNormalized = expandSearchVariants(q)[0] ?? q;
    const cacheKey = catalogSearchCacheKey({
        companyId,
        query: q,
        categoryHint: opts?.categoryHint,
        limit,
    });
    const cached = await getCachedCatalogSearchAsync(cacheKey);
    if (cached) {
        return withSpokenPrices(admin, companyId, {
            ...cached,
            items: cached.items.map((r) => ({ ...r })),
            didYouMean: cached.didYouMean.map((d) => ({ ...d })),
        });
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
                if (full.error) {
                    console.warn(
                        "[searchProdutos] view_chat_produtos category error",
                        full.error.message
                    );
                }
                const catRows = (full.data ?? []) as ChatProdutoRow[];
                const rows = await finalizeRows(admin, catRows);
                const items = rows.slice(0, limit);
                const result: SearchProdutosResult = {
                    items,
                    didYouMean: [],
                    empty: items.length === 0,
                    queryNormalized: hint,
                };
                await setCachedCatalogSearchAsync(cacheKey, result);
                return withSpokenPrices(admin, companyId, result);
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
    const tagNarrowed = preferRowsMatchingTagAliases(finalized, q);
    const ranked = applySearchRelevanceRerank(q, tagNarrowed);
    const comboRows = await searchChatCombos(admin, companyId, q);
    const items = [...comboRows, ...ranked].slice(0, limit);
    const result: SearchProdutosResult = {
        items,
        didYouMean: buildDidYouMean(q, items),
        empty: items.length === 0,
        queryNormalized,
    };
    await setCachedCatalogSearchAsync(cacheKey, result);
    return withSpokenPrices(admin, companyId, result);
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

/**
 * Quando a busca principal veio vazia: varre um pool do catálogo e devolve
 * candidatos próximos (typo / token parcial) para botões de clarificação.
 */
export async function suggestNearCatalogMatches(
    admin: SupabaseClient,
    companyId: string,
    query: string,
    opts?: { limit?: number; minScore?: number }
): Promise<Array<{ id: string; label: string; price: number | null; productName: string | null; score: number }>> {
    const q = sanitizeSearchQuery(query);
    if (!q || q.length < 3) return [];
    const limit = Math.min(Math.max(opts?.limit ?? 3, 1), 5);
    const minScore = opts?.minScore ?? 0.45;

    const pool = await admin
        .from("view_chat_produtos")
        .select(SELECT_FULL)
        .eq("company_id", companyId)
        .order("product_name")
        .limit(120);
    if (pool.error) {
        console.warn("[suggestNearCatalogMatches]", pool.error.message);
        return [];
    }

    const finalized = await attachEffectivePackPrices(
        admin,
        companyId,
        await finalizeRows(admin, (pool.data ?? []) as ChatProdutoRow[])
    );
    const scored = finalized
        .map((r) => {
            const label = String(r.display_name || r.product_name || "").trim();
            const hay = `${r.product_name ?? ""} ${r.display_name ?? ""} ${r.descricao ?? ""} ${r.tags ?? ""} ${r.detalhes ?? ""}`;
            const score = Math.max(scoreDidYouMean(q, hay), scoreDidYouMean(q, label));
            return {
                id: String(r.id),
                label: label.slice(0, 40) || "Item",
                price: Number.isFinite(Number(r.preco_venda)) ? Number(r.preco_venda) : null,
                productName: String(r.product_name ?? "").trim() || null,
                score,
            };
        })
        .filter((x) => x.score >= minScore)
        .sort((a, b) => b.score - a.score);

    // Dedup por productName aproximado (mantém melhor score / prefer UN se empate)
    const seen = new Set<string>();
    const out: typeof scored = [];
    for (const row of scored) {
        const key = (row.productName || row.label).toLowerCase().slice(0, 24);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
        if (out.length >= limit) break;
    }
    return out;
}
