import type { SupabaseClient } from "@supabase/supabase-js";

export type ChatProdutoRow = {
    id:                   string;
    product_name:         string;
    descricao:            string | null;
    sigla_comercial:      string | null;
    preco_venda:          number | string | null;
    volume_quantidade:    number | string | null;
    unit_type_sigla:      string | null;
    fator_conversao:      number | string | null;
    product_volume_id:    string | null;
    category_id:          string | null;
    estoque_unidades?:    number;
};

function sanitizeSearchQuery(raw: string): string {
    return raw.replaceAll("%", "").replaceAll("'", "").trim().slice(0, 80);
}

async function attachEstoque(
    admin: SupabaseClient,
    rows: ChatProdutoRow[]
): Promise<void> {
    const volIds = [...new Set(rows.map((r) => r.product_volume_id).filter(Boolean))] as string[];
    if (!volIds.length) return;

    const { data: vols } = await admin
        .from("product_volumes")
        .select("id, estoque_atual")
        .in("id", volIds);

    const map = new Map<string, number>();
    for (const v of vols ?? []) {
        map.set(v.id as string, Number(v.estoque_atual ?? 0));
    }
    for (const r of rows) {
        if (r.product_volume_id) r.estoque_unidades = map.get(r.product_volume_id) ?? 0;
        else r.estoque_unidades = 0;
    }
}

export async function runSearchProdutos(
    admin: SupabaseClient,
    companyId: string,
    query: string,
    opts?: { categoryHint?: string | null; limit?: number }
): Promise<ChatProdutoRow[]> {
    const limit = Math.min(Math.max(opts?.limit ?? 8, 1), 20);
    const q     = sanitizeSearchQuery(query);

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
                const { data: catRows } = await admin
                    .from("view_chat_produtos")
                    .select(
                        "id, product_name, descricao, sigla_comercial, preco_venda, volume_quantidade, unit_type_sigla, fator_conversao, product_volume_id, category_id"
                    )
                    .eq("company_id", companyId)
                    .in("category_id", catIds)
                    .order("product_name")
                    .limit(limit);
                const rows = (catRows ?? []) as ChatProdutoRow[];
                await attachEstoque(admin, rows);
                return rows;
            }
        }
    }

    if (!q) return [];

    const pattern = `%${q}%`;
    const select =
        "id, product_name, descricao, sigla_comercial, preco_venda, volume_quantidade, unit_type_sigla, fator_conversao, product_volume_id, category_id";

    const { data: byName } = await admin
        .from("view_chat_produtos")
        .select(select)
        .eq("company_id", companyId)
        .ilike("product_name", pattern)
        .limit(limit);

    let rows = (byName ?? []) as ChatProdutoRow[];
    if (!rows.length) {
        const { data: byDesc } = await admin
            .from("view_chat_produtos")
            .select(select)
            .eq("company_id", companyId)
            .ilike("descricao", pattern)
            .limit(limit);
        rows = (byDesc ?? []) as ChatProdutoRow[];
    }
    await attachEstoque(admin, rows);
    return rows;
}
