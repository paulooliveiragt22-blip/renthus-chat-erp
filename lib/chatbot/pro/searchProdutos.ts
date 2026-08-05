import type { SupabaseClient } from "@supabase/supabase-js";
import {
    disponivelVenda,
    shouldHideWhenOutOfStock,
} from "@/lib/products/stockPolicy";
import { buildPackDisplayName } from "@/lib/products/packDisplayName";

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
    /** Unidades de venda disponíveis (estoque_base / fator). */
    disponivel_venda?:    number;
};

function sanitizeSearchQuery(raw: string): string {
    return raw.replaceAll("%", "").replaceAll("'", "").trim().slice(0, 80);
}

const SELECT_FULL =
    "id, produto_id, product_name, display_name, descricao, detalhes, sigla_comercial, preco_venda, volume_quantidade, unit_type_sigla, fator_conversao, product_volume_id, category_id, estoque_unidades, vender_com_estoque_zero, thumbnail_url, image_url";
const SELECT_LEGACY =
    "id, produto_id, product_name, descricao, sigla_comercial, preco_venda, volume_quantidade, unit_type_sigla, fator_conversao, product_volume_id, category_id";

async function attachEstoqueFallback(
    admin: SupabaseClient,
    rows: ChatProdutoRow[]
): Promise<void> {
    const needFallback = rows.filter((r) => {
        const n = Number(r.estoque_unidades);
        return !Number.isFinite(n);
    });
    // Também completa quem veio 0 sem volume id resolvido via product_id
    const needProductFallback = rows.filter(
        (r) => !r.product_volume_id && r.produto_id && !Number.isFinite(Number(r.estoque_unidades))
    );

    const volIds = [
        ...new Set(
            [...needFallback, ...needProductFallback]
                .map((r) => r.product_volume_id)
                .filter(Boolean)
        ),
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
        // IA / draft usam product_name como rótulo ao cliente
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
                return rows.slice(0, limit);
            }
        }
    }

    if (!q) return [];

    const pattern = `%${q}%`;

    const byNameRes = await admin
        .from("view_chat_produtos")
        .select(SELECT_FULL)
        .eq("company_id", companyId)
        .ilike("product_name", pattern)
        .limit(limit * 2);
    let rows = (byNameRes.data ?? []) as ChatProdutoRow[];
    if (byNameRes.error) {
        const legacy = await admin
            .from("view_chat_produtos")
            .select(SELECT_LEGACY)
            .eq("company_id", companyId)
            .ilike("product_name", pattern)
            .limit(limit * 2);
        rows = (legacy.data ?? []) as ChatProdutoRow[];
    }

    if (!rows.length) {
        const byDescRes = await admin
            .from("view_chat_produtos")
            .select(SELECT_FULL)
            .eq("company_id", companyId)
            .ilike("descricao", pattern)
            .limit(limit * 2);
        rows = (byDescRes.data ?? []) as ChatProdutoRow[];
        if (byDescRes.error) {
            const legacy = await admin
                .from("view_chat_produtos")
                .select(SELECT_LEGACY)
                .eq("company_id", companyId)
                .ilike("descricao", pattern)
                .limit(limit * 2);
            rows = (legacy.data ?? []) as ChatProdutoRow[];
        }
    }
    const finalized = await finalizeRows(admin, rows);
    return finalized.slice(0, limit);
}
