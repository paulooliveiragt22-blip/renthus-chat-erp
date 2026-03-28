/**
 * lib/chatbot/parsers/ProductMatcher.ts
 *
 * Busca e valida produtos diretamente em produto_embalagens.
 * É a fonte da verdade para o fluxo de confirmação de item.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PackagingMatch {
    produto_id:   string;
    produto_nome: string;
    embalagem_id: string;
    sigla:        string;
    descricao:    string | null;
    volume:       number | null;
    unidade:      string | null;
    fator:        number;
    preco:        number;
    tags:         string | null;
}

export interface MatchResult {
    success: boolean;
    unique:  boolean;
    matches: PackagingMatch[];
    reason?: "produto_nao_encontrado" | "embalagem_nao_encontrada";
}

// ─── Normalização de sigla ────────────────────────────────────────────────────

/** Converte variações textuais do cliente para a sigla canônica do banco. */
export function normalizeSigla(input: string): string | null {
    const MAP: Record<string, string> = {
        un: "UN", unid: "UN", unidade: "UN",
        cx: "CX", caixa: "CX", cxa: "CX",
        fard: "FARD", fardo: "FARD", fd: "FARD",
        pct: "PAC", pac: "PAC", pack: "PAC", pacote: "PAC",
    };
    return MAP[input.toLowerCase().trim()] ?? null;
}

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface EmbalagemRaw {
    id:               string;
    produto_id:       string;
    descricao:        string | null;
    fator_conversao:  string | number;
    preco_venda:      string | number;
    tags:             string | null;
    volume_quantidade: string | number | null;
    siglas_comerciais: { sigla: string } | null;
    unit_types:        { sigla: string } | null;
}

// ─── Busca principal ──────────────────────────────────────────────────────────

/**
 * Busca embalagens que correspondem ao produto e, opcionalmente, à sigla comercial.
 *
 * Estratégia em dois passos:
 *   1. Busca products.name ILIKE → obtém IDs de produtos ativos
 *   2. Busca produto_embalagens em paralelo:
 *      (a) por produto_id IN [lista]
 *      (b) por descricao/tags ILIKE (para sinônimos)
 *   3. Faz merge, deduplicação e filtragem de sigla em memória
 */
export async function findProductWithPackaging(
    admin:          SupabaseClient,
    companyId:      string,
    produtoNome:    string,
    siglaComercial: string | null
): Promise<MatchResult> {
    const term = `%${produtoNome.trim().toLowerCase()}%`;

    // ── 1. Produtos ativos por nome ───────────────────────────────────────────
    const { data: matchingProds } = await admin
        .from("products")
        .select("id, name")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .ilike("name", term);

    const productIdMap = new Map<string, string>(
        (matchingProds ?? []).map((p: { id: string; name: string }) => [p.id, p.name])
    );
    const productIds = [...productIdMap.keys()];

    // ── 2. Embalagens em paralelo ─────────────────────────────────────────────
    const embSelect = `
        id, produto_id, descricao, fator_conversao, preco_venda,
        tags, volume_quantidade,
        siglas_comerciais ( sigla ),
        unit_types ( sigla )
    `;

    const byProductIdPromise = productIds.length > 0
        ? admin
              .from("produto_embalagens")
              .select(embSelect)
              .eq("company_id", companyId)
              .in("produto_id", productIds)
        : Promise.resolve({ data: [] as EmbalagemRaw[], error: null });

    const byTextPromise = admin
        .from("produto_embalagens")
        .select(embSelect)
        .eq("company_id", companyId)
        .or(`descricao.ilike.${term},tags.ilike.${term}`);

    const [r1, r2] = await Promise.all([byProductIdPromise, byTextPromise]);

    // ── 3. Merge sem duplicatas ───────────────────────────────────────────────
    const seen     = new Set<string>();
    const rawRows: EmbalagemRaw[] = [];
    for (const row of [...(r1.data ?? []), ...(r2.data ?? [])]) {
        if (!seen.has((row as EmbalagemRaw).id)) {
            seen.add((row as EmbalagemRaw).id);
            rawRows.push(row as EmbalagemRaw);
        }
    }

    if (rawRows.length === 0) {
        return { success: false, unique: false, matches: [], reason: "produto_nao_encontrado" };
    }

    // ── 4. Resolve nomes de produtos encontrados via descricao/tags ───────────
    const missingIds = [...new Set(
        rawRows
            .filter((e) => !productIdMap.has(e.produto_id))
            .map((e) => e.produto_id)
    )];

    if (missingIds.length > 0) {
        const { data: extraProds } = await admin
            .from("products")
            .select("id, name")
            .in("id", missingIds)
            .eq("company_id", companyId)
            .eq("is_active", true);

        for (const p of (extraProds ?? []) as { id: string; name: string }[]) {
            productIdMap.set(p.id, p.name);
        }
    }

    // ── 5. Mapeia → filtra sigla ──────────────────────────────────────────────
    let matches: PackagingMatch[] = rawRows
        .filter((e) => productIdMap.has(e.produto_id) && e.siglas_comerciais != null)
        .map((e) => ({
            produto_id:   e.produto_id,
            produto_nome: productIdMap.get(e.produto_id)!,
            embalagem_id: e.id,
            sigla:        e.siglas_comerciais!.sigla,
            descricao:    e.descricao,
            volume:       e.volume_quantidade != null ? Number(e.volume_quantidade) : null,
            unidade:      e.unit_types?.sigla ?? null,
            fator:        Number(e.fator_conversao),
            preco:        Number(e.preco_venda),
            tags:         e.tags,
        }));

    if (siglaComercial) {
        matches = matches.filter((m) => m.sigla === siglaComercial);
        if (!matches.length) {
            return { success: false, unique: false, matches: [], reason: "embalagem_nao_encontrada" };
        }
    }

    if (!matches.length) {
        return { success: false, unique: false, matches: [], reason: "produto_nao_encontrado" };
    }

    return { success: true, unique: matches.length === 1, matches };
}
