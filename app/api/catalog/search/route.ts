/**
 * GET /api/catalog/search?company_id=xxx&q=heineken&limit=20
 *
 * Busca global de produtos por nome/descrição.
 * Usa a view_chat_produtos que já tem todos os joins necessários.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const query     = searchParams.get("q")?.trim() ?? "";
  const limit     = Math.min(parseInt(searchParams.get("limit") ?? "20"), 50);

  if (!companyId || !query) {
    return NextResponse.json({ error: "company_id and q required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // view_chat_produtos já consolida product_name, sigla_comercial, unit_type_sigla
  // e tem is_active do produto pai
  const { data, error } = await admin
    .from("view_chat_produtos")
    .select(
      "id, product_name, descricao, preco_venda, volume_quantidade, unit_type_sigla, sigla_comercial, fator_conversao, is_active, category_id"
    )
    .eq("company_id", companyId)
    .eq("is_active", true)
    .or(`product_name.ilike.%${query}%,descricao.ilike.%${query}%,tags.ilike.%${query}%`)
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = (data ?? []).map((p: any) => ({
    id:          p.id,
    name:        [p.product_name, p.descricao, p.volume_quantidade, p.unit_type_sigla]
                   .filter(Boolean).join(" "),
    description: p.fator_conversao > 1
                   ? `${p.sigla_comercial} — ${p.fator_conversao} un`
                   : `${p.sigla_comercial || ""} — Unidade`,
    price:       parseFloat(p.preco_venda) || 0,
    in_stock:    true, // view não filtra estoque; pode ser refinado
  }));

  return NextResponse.json({ results, total: results.length });
}
