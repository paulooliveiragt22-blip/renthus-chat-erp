/**
 * GET /api/catalog/search?company_id=xxx&q=heineken&limit=20
 *
 * Busca global de produtos por nome/descrição.
 * Usa a view_chat_produtos que já tem todos os joins necessários.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit } from "@/lib/security/rateLimit";

export const runtime = "nodejs";
const RL_LIMIT = 120;
const RL_WINDOW_MS = 60_000;

function getRequesterIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function GET(request: NextRequest) {
  const rl = checkRateLimit(`catalog_search:${getRequesterIp(request)}`, RL_LIMIT, RL_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const query     = searchParams.get("q")?.trim() ?? "";
  const limit     = Math.min(Number.parseInt(searchParams.get("limit") ?? "20", 10), 50);

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
    price:       Number.parseFloat(p.preco_venda) || 0,
    in_stock:    true, // view não filtra estoque; pode ser refinado
  }));

  return NextResponse.json({ results, total: results.length });
}
