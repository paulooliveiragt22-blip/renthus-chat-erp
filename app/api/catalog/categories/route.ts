/**
 * GET /api/catalog/categories?company_id=xxx&search=xxx
 *
 * Retorna categorias de produtos ativas com contagem.
 * Chamado pelo Flow Catálogo (server-side, sem auth de usuário).
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

const CATEGORY_EMOJIS: Record<string, string> = {
  cervejas:      "🍺",
  cerveja:       "🍺",
  refrigerantes: "🥤",
  refrigerante:  "🥤",
  águas:         "💧",
  agua:          "💧",
  sucos:         "🧃",
  suco:          "🧃",
  energéticos:   "⚡",
  energetico:    "⚡",
  vinhos:        "🍷",
  vinho:         "🍷",
  destilados:    "🥃",
  destilado:     "🥃",
  snacks:        "🍟",
  comidas:       "🍔",
};

function getEmoji(name: string): string {
  const key = name.toLowerCase().normalize("NFD").replaceAll(/[\u0300-\u036f]/g, "");
  for (const [k, emoji] of Object.entries(CATEGORY_EMOJIS)) {
    const kNorm = k.normalize("NFD").replaceAll(/[\u0300-\u036f]/g, "");
    if (key.includes(kNorm)) return emoji;
  }
  return "📦";
}

export async function GET(request: NextRequest) {
  const rl = checkRateLimit(`catalog_categories:${getRequesterIp(request)}`, RL_LIMIT, RL_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("company_id");
  const search    = searchParams.get("search")?.trim() ?? "";

  if (!companyId) {
    return NextResponse.json({ error: "company_id required" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Busca categorias com produtos ativos via join
  const { data, error } = await admin
    .from("products")
    .select("category_id, categories!inner(id, name)")
    .eq("company_id", companyId)
    .eq("is_active", true)
    .not("category_id", "is", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Agrupa e conta por categoria
  const counts: Record<string, { name: string; count: number }> = {};
  for (const row of data ?? []) {
    const cat = (row as any).categories;
    if (!cat?.id) continue;
    if (!counts[cat.id]) counts[cat.id] = { name: cat.name, count: 0 };
    counts[cat.id].count++;
  }

  const categories = Object.entries(counts)
    .filter(([, v]) => {
      if (!search) return true;
      return v.name.toLowerCase().includes(search.toLowerCase());
    })
    .map(([id, v]) => ({
      id,
      name: v.name,
      emoji: getEmoji(v.name),
      product_count: v.count,
    }))
    .sort((a, b) => b.product_count - a.product_count);

  return NextResponse.json({ categories });
}
