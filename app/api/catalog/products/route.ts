/**
 * GET /api/catalog/products?company_id=xxx&category_id=xxx&customer_phone=xxx&search=xxx&limit=30
 *
 * Retorna top produtos por categoria + favoritos do cliente.
 * Chamado pelo Flow Catálogo (server-side, sem auth de usuário).
 *
 * Usa as RPCs:
 *   - get_top_products_by_category (migration 20260327000006)
 *   - get_customer_favorites        (migration 20260327000006)
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyId     = searchParams.get("company_id");
  const categoryId    = searchParams.get("category_id") ?? null;  // UUID da categoria
  const categoryName  = searchParams.get("category") ?? null;      // nome (alternativa)
  const customerPhone = searchParams.get("customer_phone") ?? null;
  const search        = searchParams.get("search")?.trim() ?? "";
  const limit         = Math.min(parseInt(searchParams.get("limit") ?? "30"), 50);

  if (!companyId) {
    return NextResponse.json({ error: "company_id required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Resolve nome da categoria pelo UUID (se category_id fornecido)
  let resolvedCategoryName: string | null = categoryName;
  if (categoryId && !resolvedCategoryName) {
    const { data: cat } = await admin
      .from("categories")
      .select("name")
      .eq("id", categoryId)
      .maybeSingle();
    resolvedCategoryName = cat?.name ?? null;
  }

  // 1. Favoritos do cliente (se phone fornecido)
  let favorites: any[] = [];
  if (customerPhone) {
    const { data } = await admin.rpc("get_customer_favorites", {
      p_company_id:     companyId,
      p_customer_phone: customerPhone,
      p_limit:          5,
    });
    favorites = data ?? [];
  }

  // 2. Top produtos
  const { data: topProducts, error } = await admin.rpc("get_top_products_by_category", {
    p_company_id: companyId,
    p_category:   resolvedCategoryName,
    p_limit:      limit,
    p_days:       30,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 3. Filtra por busca (client-side após RPC)
  let products: any[] = topProducts ?? [];
  if (search) {
    const q = search.toLowerCase();
    products = products.filter(
      (p: any) =>
        p.name.toLowerCase().includes(q) ||
        p.description?.toLowerCase().includes(q)
    );
  }

  // 4. Formata resposta
  const favoriteIds = new Set(favorites.map((f: any) => f.id));
  const formatted = products.map((p: any) => ({
    id:          p.id,
    name:        p.name,
    description: p.description,
    price:       Number.parseFloat(p.price),
    image_url:   p.thumbnail_url || p.image_url,
    category:    p.category,
    in_stock:    p.in_stock,
    is_favorite: favoriteIds.has(p.id),
  }));

  return NextResponse.json({
    favorites: favorites.slice(0, 5),
    products:  formatted,
    total:     formatted.length,
  });
}
