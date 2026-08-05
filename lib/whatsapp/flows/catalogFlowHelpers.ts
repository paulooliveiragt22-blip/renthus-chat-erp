import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

const CHAT_PRODUTOS_SELECT =
    "id, product_name, display_name, descricao, detalhes, preco_venda, volume_quantidade, fator_conversao, id_unit_type, product_volume_id, unit_type_sigla, sigla_comercial, thumbnail_url, image_url";

export type CatalogCategoryOption = { id: string; title: string; description: string };

export function buildCatalogCategoriesFromProductRows(
    rows: any[] | null | undefined
): CatalogCategoryOption[] {
    const counts: Record<string, { name: string; count: number }> = {};
    for (const row of rows ?? []) {
        const cat = row.categories;
        if (!cat?.id) continue;
        if (!counts[cat.id]) counts[cat.id] = { name: cat.name, count: 0 };
        counts[cat.id].count++;
    }
    return Object.entries(counts)
        .map(([id, v]) => ({
            id,
            title:       v.name.toUpperCase(),
            description: `${v.count} produto${v.count === 1 ? "" : "s"}`,
        }))
        .sort((a, b) => (counts[b.id]?.count ?? 0) - (counts[a.id]?.count ?? 0));
}

function buildProductItemsForFlow(rows: any[]): Array<Record<string, unknown>> {
    return rows.map((p: any) => {
        const sigla     = String(p.sigla_comercial ?? "").toUpperCase();
        const fator     = Number(p.fator_conversao ?? 0);
        const title = String(p.display_name || p.product_name || "").trim();
        const detalhes = String(p.detalhes ?? "").trim();
        const price = `R$ ${(Number.parseFloat(p.preco_venda) || 0).toFixed(2).replaceAll(".", ",")}`;
        const fatorSafe = Math.max(1, fator || 1);
        const packHint = sigla ? `${sigla}:${fatorSafe}` : "";
        const desc = [detalhes, packHint, price].filter(Boolean).join(" — ");

        return {
            id:          p.id,
            title:       title.toUpperCase().slice(0, 30),
            description: desc.slice(0, 300),
        };
    });
}

export async function fetchFlowCatalogProducts(
    admin: SupabaseClient,
    companyId: string,
    opts: {
        categoryName?: string | null;
        categoryId?: string | null;
        search?: string | null;
    }
): Promise<Array<Record<string, unknown>>> {
    if (opts.search) {
        const { data } = await admin
            .from("view_chat_produtos")
            .select(CHAT_PRODUTOS_SELECT)
            .eq("company_id", companyId)
            .ilike("product_name", `%${opts.search}%`)
            .limit(20);

        return buildProductItemsForFlow(data ?? []);
    }

    let query = admin
        .from("view_chat_produtos")
        .select(CHAT_PRODUTOS_SELECT)
        .eq("company_id", companyId)
        .order("product_name");

    if (opts.categoryId) {
        query = query.eq("category_id", opts.categoryId);
    } else if (opts.categoryName) {
        const { data: cat } = await admin
            .from("categories")
            .select("id")
            .eq("company_id", companyId)
            .ilike("name", opts.categoryName)
            .maybeSingle();
        if (cat?.id) query = query.eq("category_id", cat.id);
    }

    const { data } = await query.limit(20);
    return buildProductItemsForFlow(data ?? []);
}

export async function fetchFlowFavoriteItems(
    admin: SupabaseClient,
    companyId: string,
    customerPhone: string | null
): Promise<Array<Record<string, unknown>>> {
    if (!customerPhone) return [];
    const { data, error } = await admin.rpc("get_customer_favorites", {
        p_company_id:     companyId,
        p_customer_phone: customerPhone,
        p_limit:          5,
    });
    if (error) {
        console.warn("[catalog_flow] get_customer_favorites ignorado:", error.code ?? "", error.message ?? "");
        return [];
    }
    const rows = Array.isArray(data) ? data : data ? [data] : [];
    if (!rows.length) return [];
    return (rows as any[]).map((f: any) => {
        const price = `R$ ${(Number.parseFloat(f.price) || 0).toFixed(2).replaceAll(".", ",")}`;
        return {
            id:          f.id,
            title:       `⭐ ${String(f.name ?? "").toUpperCase().slice(0, 27)}`,
            description: `${String(f.description ?? "")} — ${price}`.slice(0, 300),
        };
    });
}

export async function saveCatalogFlowScreen(
    admin: SupabaseClient,
    threadId: string,
    nextScreen: string,
    existingCtx?: Record<string, unknown>
): Promise<void> {
    let ctx = existingCtx;
    if (ctx === undefined) {
        const { data: ctxRow } = await admin
            .from("chatbot_sessions")
            .select("context")
            .eq("thread_id", threadId)
            .maybeSingle();
        ctx = (ctxRow?.context ?? {}) as Record<string, unknown>;
    }
    await admin
        .from("chatbot_sessions")
        .update({ context: { ...ctx, catalog_screen: nextScreen } })
        .eq("thread_id", threadId);
}
