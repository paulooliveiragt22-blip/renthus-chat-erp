/**
 * lib/chatbot/db/variants.ts
 *
 * Funções de acesso ao catálogo de produtos/variantes no Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Brand, VariantRow, ProductListItem, DeliveryZone } from "../types";
import { normalize } from "../utils";
import { stripCategoryPrefix } from "../textParsers";

// ─── Categorias ───────────────────────────────────────────────────────────────

export async function getCategories(admin: SupabaseClient, companyId: string): Promise<Category[]> {
    const { data } = await admin
        .from("view_categories")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("name");

    return (data as Category[]) ?? [];
}

// ─── Produtos por categoria ───────────────────────────────────────────────────

export async function getProductsByCategory(
    admin: SupabaseClient,
    companyId: string,
    categoryId: string,
    categoryName: string
): Promise<ProductListItem[]> {
    const { data: rows } = await admin
        .from("view_chat_produtos")
        .select("id, produto_id, descricao, fator_conversao, preco_venda, product_name, sigla_comercial")
        .eq("company_id", companyId)
        .eq("category_id", categoryId)
        .limit(500);

    if (!rows?.length) return [];

    const BULK_SIGLAS = new Set(["CX", "CAIXA", "FARD", "PAC"]);
    const byProd: Record<string, { unit: any | null; case: any | null }> = {};
    for (const r of rows as any[]) {
        const pid = String(r.produto_id);
        byProd[pid] ??= { unit: null, case: null };
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN" || sig === "UNIDADE") byProd[pid].unit = r;
        if (BULK_SIGLAS.has(sig) && !byProd[pid].case) byProd[pid].case = r; // primeiro bulk encontrado
    }

    const options: ProductListItem[] = [];
    let idx = 1;
    const seen = new Set<string>();

    for (const r of rows as any[]) {
        const pid = String(r.produto_id);
        if (seen.has(pid)) continue;
        const unitPack = byProd[pid]?.unit;
        if (!unitPack) continue;
        seen.add(pid);

        const shortName = stripCategoryPrefix(r.product_name, categoryName);
        const vol = unitPack.descricao ? String(unitPack.descricao) : null;
        const displayName = vol ? `${shortName} ${vol}` : shortName;
        const casePack = byProd[pid]?.case ?? null;

        options.push({
            idx:         idx++,
            productId:   pid,
            variantId:   String(unitPack.id),
            displayName,
            unitPrice:   Number(unitPack.preco_venda ?? 0),
            hasCase:     Boolean(casePack),
            caseQty:     casePack?.fator_conversao ? Number(casePack.fator_conversao) : undefined,
            casePrice:   casePack?.preco_venda ? Number(casePack.preco_venda) : undefined,
        });

        if (idx > 10) break;
    }

    return options;
}

// ─── Variantes por categoria ──────────────────────────────────────────────────

/** @deprecated Marca removida — retorna [] */
export async function getBrandsByCategory(): Promise<Brand[]> {
    return [];
}

export async function getVariantsByBrandAndCategory(
    admin: SupabaseClient,
    companyId: string,
    _brandId: string,
    categoryId: string
): Promise<VariantRow[]> {
    return getVariantsByCategory(admin, companyId, categoryId);
}

export async function getVariantsByCategory(
    admin: SupabaseClient,
    companyId: string,
    categoryId: string
): Promise<VariantRow[]> {
    const { data: rows } = await admin
        .from("view_chat_produtos")
        .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, is_acompanhamento, sigla_comercial, product_name, product_unit_type, product_details, volume_quantidade, unit_type_sigla, product_volume_id")
        .eq("company_id", companyId)
        .eq("category_id", categoryId)
        .limit(500);

    if (!rows?.length) return [];

    const BULK_SIGLAS_SET = new Set(["CX", "FARD", "PAC"]);
    const byVol: Record<string, { unit: any | null; case: any | null; caseSigla: string | null; prodId: string }> = {};
    const volOrder: string[] = [];
    for (const r of rows as any[]) {
        const key = `${r.produto_id}::${r.product_volume_id ?? "null"}`;
        if (!byVol[key]) {
            byVol[key] = { unit: null, case: null, caseSigla: null, prodId: String(r.produto_id) };
            volOrder.push(key);
        }
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN" && !byVol[key].unit) byVol[key].unit = r;
        if (BULK_SIGLAS_SET.has(sig) && !byVol[key].case) {
            byVol[key].case = r;
            byVol[key].caseSigla = sig;
        }
    }

    const variants: VariantRow[] = [];
    for (const key of volOrder) {
        const unitPack = byVol[key]?.unit ?? null;
        const casePack = byVol[key]?.case ?? null;
        if (!unitPack && !casePack) continue;

        const p = unitPack ?? casePack;
        const volQty  = Number((unitPack ?? casePack)?.volume_quantidade ?? 0);
        const utSigla = String((unitPack ?? casePack)?.unit_type_sigla ?? "") || null;
        const prodId  = byVol[key].prodId;
        variants.push({
            id: String(unitPack?.id ?? casePack?.id ?? key),
            productId: prodId,
            productName: String(p?.product_name ?? ""),
            details: (unitPack?.descricao ?? casePack?.descricao ?? p?.product_details ?? null) as string | null,
            tags: unitPack?.tags ?? casePack?.tags ?? null,
            volumeValue: volQty,
            unit: String(p?.product_unit_type ?? "un"),
            unitTypeSigla: utSigla,
            unitPrice: Number(unitPack?.preco_venda ?? casePack?.preco_venda ?? 0),
            hasCase: Boolean(casePack),
            caseQty: casePack ? Number(casePack.fator_conversao ?? 1) : null,
            casePrice: casePack ? Number(casePack.preco_venda ?? 0) : null,
            bulkSigla: byVol[key]?.caseSigla ?? null,
            caseVariantId: casePack ? String(casePack.id) : undefined,
            isAccompaniment: Boolean(unitPack?.is_acompanhamento || casePack?.is_acompanhamento),
        });
    }

    variants.sort((a, b) => (a.unitPrice ?? 0) - (b.unitPrice ?? 0));
    return variants;
}

// ─── Busca por texto ──────────────────────────────────────────────────────────

/**
 * Busca variantes por texto livre com OR-scoring.
 *
 * Lógica de pontuação por variante:
 *   +4  → termo bate exatamente no início do nome do produto (ex: "skol" em "Skol Lata")
 *   +2  → termo contido em qualquer parte do nome do produto
 *   +1  → termo contido em tags ou detalhes
 *
 * Uma variante é incluída se QUALQUER termo bater em pelo menos um campo.
 * Resultados são ordenados por score decrescente → mais relevantes primeiro.
 *
 * Se nenhum resultado for encontrado via JS, faz uma segunda passagem com
 * queries .ilike() direto no Supabase (fallback para casos onde o cache
 * de 300 linhas não capturou o produto).
 */
export async function searchVariantsByText(
    admin: SupabaseClient,
    companyId: string,
    searchInput: string | string[],
    limit = 10
): Promise<VariantRow[]> {
    // Novo modelo (produto_embalagens). Mantemos a implementação antiga como fallback,
    // mas delegamos para a nova função para não depender de `product_variants`.
    return searchVariantsByTextV2(admin, companyId, searchInput, limit);

    // Normaliza entrada → array de termos limpos (sem stopwords já removidas pelo caller)
    const terms: string[] = Array.isArray(searchInput)
        ? (searchInput as string[]).map((x: string) => normalize(x)).filter((t: string) => t.length >= 2)
        : normalize(searchInput as string).split(/\s+/).filter((t: string) => t.length >= 2);

    if (!terms.length) return [];

    // ── Passagem 1: busca ampla em memória ────────────────────────────────────
    const { data, error } = await admin
        .from("product_variants")
        .select(`
            id, product_id, details, tags, volume_value, unit,
            unit_price, has_case, case_qty, case_price, is_accompaniment,
            products!inner(id, name, is_active)
        `)
        .eq("company_id", companyId)
        .eq("is_active", true)
        .limit(400);

    if (error) console.error("[search] erro Supabase:", error?.message);
    if (!data?.length) return [];

    type Scored = { row: VariantRow; score: number };
    const scored: Scored[] = [];

    for (const v of data as any[]) {
        const p = Array.isArray(v.products) ? v.products[0] : v.products;
        if (!p?.is_active) continue;

        const productName = normalize(String(p?.name ?? ""));
        const tagStr      = v.tags    ? normalize(String(v.tags))    : "";
        const detailStr   = v.details ? normalize(String(v.details)) : "";

        let totalScore = 0;

        for (const term of terms) {
            // Nome exato no início → prioridade máxima
            if (productName.startsWith(term))          totalScore += 4;
            // Nome contém o termo em qualquer posição
            else if (productName.includes(term))       totalScore += 2;

            // Tags: cada tag separada por vírgula é comparada individualmente
            if (tagStr) {
                const tagTokens = tagStr.split(/[,;]+/).map((t: string) => t.trim());
                if (tagTokens.some((t: string) => t.includes(term) || term.includes(t)))
                    totalScore += 1;
            }

            // Detalhes: busca simples de substring
            if (detailStr.includes(term)) totalScore += 1;
        }

        // Inclui se ao menos 1 ponto (qualquer match parcial)
        if (totalScore <= 0) continue;

        scored.push({
            score: totalScore,
            row: {
                id:              String(v.id),
                productId:       String(v.product_id),
                productName:     String(p?.name ?? ""),
                details:         v.details ?? null,
                tags:            v.tags    ?? null,
                volumeValue:     Number(v.volume_value ?? 0),
                unit:            v.unit ?? "ml",
                unitTypeSigla:   null,
                unitPrice:       Number(v.unit_price ?? 0),
                hasCase:         Boolean(v.has_case),
                caseQty:         v.case_qty   ? Number(v.case_qty)   : null,
                casePrice:       v.case_price ? Number(v.case_price) : null,
                bulkSigla:       v.has_case ? "CX" : null,
                isAccompaniment: Boolean(v.is_accompaniment),
            },
        });
    }

    scored.sort((a, b) => b.score - a.score);
    const pass1 = scored.slice(0, limit).map((s) => s.row);

    if (pass1.length > 0) return pass1;

    // ── Passagem 2: fallback via .ilike() no Supabase ─────────────────────────
    // Útil se o catálogo tiver mais de 400 variantes ou a variante estava inativa

    const ilikeFilters = terms.map((t) => `products.name.ilike.%${t}%`).join(",");
    const { data: fallbackData } = await admin
        .from("product_variants")
        .select(`
            id, product_id, details, tags, volume_value, unit,
            unit_price, has_case, case_qty, case_price, is_accompaniment,
            products!inner(id, name, is_active)
        `)
        .eq("company_id", companyId)
        .eq("is_active", true)
        .or(ilikeFilters)
        .limit(limit);

    if (!fallbackData?.length) return [];

    return ((fallbackData ?? []) as any[])
        .filter((v) => {
            const p = Array.isArray(v.products) ? v.products[0] : v.products;
            return p?.is_active;
        })
        .map((v) => {
            const p = Array.isArray(v.products) ? v.products[0] : v.products;
            return {
                id:              String(v.id),
                productId:       String(v.product_id),
                productName:     String(p?.name ?? ""),
                details:         v.details ?? null,
                tags:            v.tags    ?? null,
                volumeValue:     Number(v.volume_value ?? 0),
                unit:            v.unit ?? "ml",
                unitTypeSigla:   null,
                unitPrice:       Number(v.unit_price ?? 0),
                hasCase:         Boolean(v.has_case),
                caseQty:         v.case_qty   ? Number(v.case_qty)   : null,
                casePrice:       v.case_price ? Number(v.case_price) : null,
                bulkSigla:       v.has_case ? "CX" : null,
                isAccompaniment: Boolean(v.is_accompaniment),
            };
        })
        .slice(0, limit);
}

// Nova implementação para o modelo atual: agrupa `produto_embalagens` (UN/CX)
// em uma estrutura do tipo `VariantRow` (que representa a "linha" de venda).
export async function searchVariantsByTextV2(
    admin: SupabaseClient,
    companyId: string,
    searchInput: string | string[],
    limit = 10
): Promise<VariantRow[]> {
    const terms: string[] = Array.isArray(searchInput)
        ? searchInput.map(normalize).filter((t) => t.length >= 2)
        : normalize(searchInput).split(/\s+/).filter((t) => t.length >= 2);

    if (!terms.length) return [];

    const { data, error } = await admin
        .from("view_chat_produtos")
        .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, is_acompanhamento, sigla_comercial, product_name, product_unit_type, product_details, volume_quantidade, unit_type_sigla, product_volume_id")
        .eq("company_id", companyId)
        .limit(800);

    if (error) {
        console.error("[searchV2] erro Supabase:", error.message);
        return [];
    }
    if (!data?.length) return [];

    const BULK = new Set(["CX", "FARD", "PAC"]);

    // Group by (produto_id, product_volume_id) — each distinct volume = separate variant
    const byVol: Record<string, {
        unitPack:  any | null;
        casePack:  any | null;
        caseSigla: string | null;
        prodId:    string;
        tags:      string[];
    }> = {};

    for (const r of data as any[]) {
        const key = `${r.produto_id}::${r.product_volume_id ?? "null"}`;
        byVol[key] ??= { unitPack: null, casePack: null, caseSigla: null, prodId: String(r.produto_id), tags: [] };
        const sig = String(r.sigla_comercial ?? "").toUpperCase();
        if (sig === "UN" && !byVol[key].unitPack) byVol[key].unitPack = r;
        if (BULK.has(sig) && !byVol[key].casePack) {
            byVol[key].casePack  = r;
            byVol[key].caseSigla = sig;
        }
        if (r.tags) byVol[key].tags.push(String(r.tags));
    }

    const variants: VariantRow[] = Object.entries(byVol)
        .map(([, grp]) => {
            const unitPack = grp.unitPack ?? grp.casePack;
            const casePack = grp.casePack;
            if (!unitPack) return null;

            const volQty  = Number(unitPack.volume_quantidade ?? 0);
            const utSigla = String(unitPack.unit_type_sigla ?? "") || null;
            return {
                id:           String(unitPack.id),
                productId:    grp.prodId,
                productName:  String(unitPack.product_name ?? ""),
                details:      (unitPack.descricao ?? unitPack.product_details ?? null) as string | null,
                searchDesc:   (unitPack.descricao ?? null) as string | null,
                tags:         grp.tags.length ? grp.tags.join(",") : null,
                volumeValue:  volQty,
                unit:         String(unitPack.product_unit_type ?? "un"),
                unitTypeSigla: utSigla,
                unitPrice:    Number(unitPack.preco_venda ?? 0),
                hasCase:      Boolean(casePack),
                caseQty:      casePack ? Number(casePack.fator_conversao ?? 1) : null,
                casePrice:    casePack ? Number(casePack.preco_venda ?? 0) : null,
                bulkSigla:    grp.caseSigla,
                caseVariantId: casePack ? String(casePack.id) : undefined,
                isAccompaniment: Boolean(unitPack.is_acompanhamento || casePack?.is_acompanhamento),
            };
        })
        .filter(Boolean) as VariantRow[];

    // 2) Score JS (mesma ideia da versão antiga)
    type Scored = { row: VariantRow; score: number };
    const scored: Scored[] = [];

    for (const v of variants as any[]) {
        const productNameNorm = normalize(String(v.productName ?? ""));
        const tagStr = v.tags ? normalize(String(v.tags)) : "";
        const detailStr = v.details ? normalize(String(v.details)) : "";
        const searchDescStr = v.searchDesc ? normalize(String(v.searchDesc)) : "";

        let totalScore = 0;
        for (const term of terms) {
            if (productNameNorm.startsWith(term)) totalScore += 4;
            else if (productNameNorm.includes(term)) totalScore += 2;

            if (tagStr) {
                const tagTokens = tagStr.split(/[,;]+/).map((t: string) => t.trim());
                if (tagTokens.some((t: string) => (t ? t.includes(term) : false) || (term ? term.includes(t) : false))) {
                    totalScore += 1;
                }
            }
            if (searchDescStr.includes(term)) totalScore += 2;
            if (detailStr.includes(term)) totalScore += 1;
        }
        if (totalScore > 0) scored.push({ score: totalScore, row: v });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.row);
}

// ─── Acompanhamentos ──────────────────────────────────────────────────────────

/** Busca itens de acompanhamento para sugerir após pedido fechado.
 *  Se cartEmbalagemIds for informado, usa produto_embalagem_acompanhamentos (produtos vinculados ao que comprou).
 *  Caso contrário, fallback para embalagens com is_acompanhamento=true. */
export async function getAccompanimentItems(
    admin: SupabaseClient,
    companyId: string,
    cartEmbalagemIds?: string[]
): Promise<VariantRow[]> {
    const out: VariantRow[] = [];
    const seen = new Set<string>();

    if (cartEmbalagemIds?.length) {
        const { data: acRows } = await admin
            .from("produto_embalagem_acompanhamentos")
            .select("acompanhamento_produto_embalagem_id")
            .in("produto_embalagem_id", cartEmbalagemIds)
            .order("ordem");

        const acompIds = [...new Set(((acRows ?? []) as any[]).map((r) => String(r.acompanhamento_produto_embalagem_id)))];
        if (acompIds.length) {
            const { data: packs } = await admin
                .from("view_chat_produtos")
                .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, product_name")
                .in("id", acompIds)
                .eq("company_id", companyId);

            for (const r of (packs ?? []) as any[]) {
                if (seen.has(String(r.id))) continue;
                seen.add(String(r.id));
                out.push({
                    id: String(r.id),
                    productId: String(r.produto_id),
                    productName: String(r.product_name ?? ""),
                    details: (r.descricao ?? null) as string | null,
                    tags: r.tags ?? null,
                    volumeValue: 0,
                    unit: "un",
                    unitTypeSigla: null,
                    unitPrice: Number(r.preco_venda ?? 0),
                    hasCase: false,
                    caseQty: null,
                    casePrice: null,
                    bulkSigla: null,
                    caseVariantId: undefined,
                    isAccompaniment: true,
                });
                if (out.length >= 5) break;
            }
        }
    }

    if (out.length < 5) {
        const { data: accompPacks } = await admin
            .from("view_chat_produtos")
            .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, sigla_comercial, product_name, product_unit_type, product_details")
            .eq("company_id", companyId)
            .eq("is_acompanhamento", true)
            .limit(50);

        const safeAcc = (accompPacks ?? []) as any[];
        if (safeAcc.length) {
            const produtoIds = [...new Set(safeAcc.map((p) => String(p.produto_id)))].slice(0, 20);
            const { data: packs } = await admin
                .from("view_chat_produtos")
                .select("id, produto_id, descricao, fator_conversao, preco_venda, tags, sigla_comercial, product_name, product_unit_type, product_details")
                .in("produto_id", produtoIds)
                .eq("company_id", companyId);

            const byProd: Record<string, { unitPack: any | null; casePack: any | null; tags: string[] }> = {};
            for (const r of (packs ?? []) as any[]) {
                const pid = String(r.produto_id);
                byProd[pid] ??= { unitPack: null, casePack: null, tags: [] };
                const sig = String(r.sigla_comercial ?? "").toUpperCase();
                if (r.tags) byProd[pid].tags.push(String(r.tags));
                if (sig === "UN") byProd[pid].unitPack = r;
                if (sig === "CX") byProd[pid].casePack = r;
            }

            for (const pid of produtoIds) {
                if (out.length >= 5) break;
                const grp = byProd[pid];
                if (!grp) continue;
                const unitPack = grp.unitPack ?? grp.casePack;
                const casePack = grp.casePack;
                if (!unitPack || seen.has(String(unitPack.id))) continue;
                seen.add(String(unitPack.id));
                out.push({
                    id: String(unitPack.id),
                    productId: pid,
                    productName: String(unitPack.product_name ?? ""),
                    details: (unitPack.descricao ?? unitPack.product_details ?? null) as string | null,
                    tags: grp.tags.length ? grp.tags.join(",") : null,
                    volumeValue: 0,
                    unit: String(unitPack.product_unit_type ?? "un"),
                    unitTypeSigla: null,
                    unitPrice: Number(unitPack.preco_venda ?? 0),
                    hasCase: Boolean(casePack),
                    caseQty: casePack ? Number(casePack.fator_conversao ?? 1) : null,
                    casePrice: casePack ? Number(casePack.preco_venda ?? 0) : null,
                    bulkSigla: casePack ? String(casePack.sigla_comercial ?? "CX").toUpperCase() : null,
                    caseVariantId: casePack ? String(casePack.id) : undefined,
                    isAccompaniment: true,
                });
            }
        }
    }

    return out.slice(0, 5);
}

// ─── Zonas de entrega ─────────────────────────────────────────────────────────

/**
 * Busca zona de entrega pelo nome do bairro usando .ilike() com % (fuzzy).
 * Ex: "São Mateus" → %sao mateus%
 */
export async function findDeliveryZone(
    admin: SupabaseClient,
    companyId: string,
    neighborhood: string
): Promise<DeliveryZone | null> {
    const normalized = normalize(neighborhood);
    const { data } = await admin
        .from("delivery_zones")
        .select("id, label, fee")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .ilike("label", `%${normalized}%`)
        .limit(1)
        .maybeSingle();

    if (!data) return null;
    return { id: data.id, label: data.label, fee: Number(data.fee) };
}

/** Lista todas as zonas de entrega ativas (para fallback). */
export async function listDeliveryZones(
    admin: SupabaseClient,
    companyId: string
): Promise<DeliveryZone[]> {
    const { data } = await admin
        .from("delivery_zones")
        .select("id, label, fee")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .order("fee", { ascending: true })
        .limit(20);

    return (data ?? []).map((z) => ({ id: z.id, label: z.label, fee: Number(z.fee) }));
}
